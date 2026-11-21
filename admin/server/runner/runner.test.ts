import assert from "node:assert/strict";
import { test } from "node:test";
import { openDb } from "../db/client";
import { JOB_KINDS } from "../db/schema";
import { enqueueJob, getJob, listLogs, requestCancel } from "../jobs";
import { updateSettings } from "../settings";
import { createRunner } from "./index";
import type { Executor, Executors } from "./types";

const gate = () => {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => { open = resolve; });
  return { promise, open };
};
const executors = (overrides: Partial<Executors>): Executors =>
  Object.fromEntries(JOB_KINDS.map((kind) => [kind, overrides[kind] ?? (async () => undefined)])) as Executors;
const waitAbort: Executor = (_job, ctx) => new Promise((_, reject) => {
  ctx.signal.addEventListener("abort", () => reject(new Error("aborted")));
});

test("两条 lane 同一次 tick 里各启动一个任务", async () => {
  const db = openDb(":memory:");
  const g = gate();
  const started: string[] = [];
  const runner = createRunner({ db, executors: executors({
    export: async () => { started.push("export"); await g.promise; },
    upload: async () => { started.push("upload"); await g.promise; },
  }) });
  enqueueJob(db, { kind: "export" });
  enqueueJob(db, { kind: "export" });
  enqueueJob(db, { kind: "upload" });
  await runner.tick();
  assert.deepEqual(started.sort(), ["export", "upload"]);
  g.open();
  await runner.whenIdle();
});

test("并行数读设置：render 调到 2 后同时跑两个", async () => {
  const db = openDb(":memory:");
  updateSettings(db, { "render.maxParallel": 2 });
  const g = gate();
  let live = 0;
  let peak = 0;
  const runner = createRunner({ db, executors: executors({
    export: async () => { live += 1; peak = Math.max(peak, live); await g.promise; live -= 1; },
  }) });
  for (let i = 0; i < 3; i += 1) enqueueJob(db, { kind: "export" });
  await runner.tick();
  assert.equal(peak, 2);
  g.open();
  await runner.whenIdle();
  await runner.tick();
  await runner.whenIdle();
  assert.equal(getJob(db, 3)?.status, "succeeded");
});

test("成功写结果和日志，失败级联取消依赖", async () => {
  const db = openDb(":memory:");
  const runner = createRunner({ db, executors: executors({
    export: async (_job, ctx) => { ctx.log("渲染中"); throw new Error("渲染崩了"); },
  }) });
  const a = enqueueJob(db, { kind: "export" });
  const b = enqueueJob(db, { kind: "cover", dependsOn: [a.id] });
  await runner.tick();
  await runner.whenIdle();
  assert.equal(getJob(db, a.id)?.status, "failed");
  assert.equal(getJob(db, a.id)?.error, "渲染崩了");
  assert.equal(getJob(db, b.id)?.status, "cancelled");
  assert.deepEqual(listLogs(db, a.id, 0).map((row) => row.line), ["渲染中", "任务失败: 渲染崩了"]);
});

test("取消：运行中的任务在下一次 tick 被中止", async () => {
  const db = openDb(":memory:");
  const runner = createRunner({ db, executors: executors({ export: waitAbort }) });
  const a = enqueueJob(db, { kind: "export" });
  await runner.tick();
  assert.equal(requestCancel(db, a.id, 1), "requested");
  await runner.tick();
  await runner.whenIdle();
  assert.equal(getJob(db, a.id)?.status, "cancelled");
});

test("stop：在跑的任务标成 interrupted", async () => {
  const db = openDb(":memory:");
  const runner = createRunner({ db, executors: executors({ export: waitAbort }) });
  const a = enqueueJob(db, { kind: "export" });
  await runner.tick();
  await runner.stop();
  assert.equal(getJob(db, a.id)?.status, "interrupted");
});
