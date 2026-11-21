import type { Db } from "../db/client";
import type { JobKind, JobRow } from "../db/schema";
import type { Settings } from "../settings";

export type LogStream = "stdout" | "stderr" | "system";

export type JobContext = {
  db: Db;
  settings: Settings;
  /** 用户取消或 runner 退出时中止。执行器要把它传给子进程和等待。 */
  signal: AbortSignal;
  log(line: string, stream?: LogStream): void;
  progress(value: number): void;
};

export type Executor = (job: JobRow, ctx: JobContext) => Promise<unknown>;
export type Executors = Record<JobKind, Executor>;
