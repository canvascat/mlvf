import type { Db } from "../db/client";
import { LANES, type JobRow } from "../db/schema";
import {
  appendLogs, cancelRequestedIds, claimNext, countRunning, finishJob, setProgress,
  type LogEntry,
} from "../jobs";
import { getSettings, type Settings } from "../settings";
import type { Executors, JobContext, LogStream } from "./types";

export type RunnerOptions = {
  db: Db;
  executors: Executors;
  now?: () => number;
  pollMs?: number;
  /** 每次 tick 之后调用，空闲调度挂在这里。 */
  onTick?: (settings: Settings) => void | Promise<void>;
};

export type Runner = {
  tick(): Promise<void>;
  start(): void;
  /** 等所有正在跑的任务结束。 */
  whenIdle(): Promise<void>;
  /** 停止领取，中止在跑的任务（标成 interrupted），等它们收尾。 */
  stop(): Promise<void>;
};

type Running = { controller: AbortController; done: Promise<void> };

export function createRunner(options: RunnerOptions): Runner {
  const { db, executors } = options;
  const now = options.now ?? Date.now;
  const running = new Map<number, Running>();
  let stopping = false;
  let timer: NodeJS.Timeout | undefined;

  async function execute(job: JobRow, settings: Settings, controller: AbortController) {
    let buffer: LogEntry[] = [];
    const flush = () => {
      if (buffer.length === 0) return;
      const batch = buffer;
      buffer = [];
      appendLogs(db, job.id, batch, now(), settings["log.maxLinesPerJob"]);
    };
    const flushTimer = setInterval(flush, 500);
    const ctx: JobContext = {
      db,
      settings,
      signal: controller.signal,
      log: (line: string, stream: LogStream = "system") => { buffer.push({ stream, line }); },
      progress: (value: number) => setProgress(db, job.id, value, now()),
    };
    try {
      const result = await executors[job.kind](job, ctx);
      clearInterval(flushTimer);
      flush();
      finishJob(db, job.id, { status: "succeeded", result }, now());
    } catch (error) {
      clearInterval(flushTimer);
      if (controller.signal.aborted) {
        flush();
        finishJob(db, job.id, stopping ? { status: "interrupted" } : { status: "cancelled" }, now());
      } else {
        const message = error instanceof Error ? error.message : String(error);
        buffer.push({ stream: "system", line: `任务失败: ${message}` });
        flush();
        finishJob(db, job.id, { status: "failed", error: message }, now());
      }
    } finally {
      running.delete(job.id);
    }
  }

  function begin(job: JobRow, settings: Settings) {
    const controller = new AbortController();
    const entry: Running = { controller, done: Promise.resolve() };
    running.set(job.id, entry);
    entry.done = execute(job, settings, controller);
  }

  const runner: Runner = {
    async tick() {
      if (stopping) return;
      const settings = getSettings(db);
      for (const id of cancelRequestedIds(db)) running.get(id)?.controller.abort();
      for (const lane of LANES) {
        const max = lane === "render" ? settings["render.maxParallel"] : settings["bili.maxParallel"];
        while (countRunning(db, lane) < max) {
          const job = claimNext(db, lane, now());
          if (!job) break;
          begin(job, settings);
        }
      }
      await options.onTick?.(settings);
    },
    start() {
      timer = setInterval(() => { void runner.tick(); }, options.pollMs ?? 1000);
      void runner.tick();
    },
    async whenIdle() {
      while (running.size > 0) await Promise.all([...running.values()].map((entry) => entry.done));
    },
    async stop() {
      stopping = true;
      if (timer) clearInterval(timer);
      for (const entry of running.values()) entry.controller.abort();
      await runner.whenIdle();
    },
  };
  return runner;
}
