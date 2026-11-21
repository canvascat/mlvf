import assert from "node:assert/strict";
import { test } from "node:test";
import { openDb } from "./db/client";
import {
  appendLogs, cancelRequestedIds, claimNext, countRunning, enqueueJob, finishJob, getJob,
  listLogs, recoverInterrupted, requestCancel, retryJob,
} from "./jobs";

const fresh = () => openDb(":memory:");

test("按 id 顺序领取，且只领一次", () => {
  const db = fresh();
  const a = enqueueJob(db, { kind: "export" });
  const b = enqueueJob(db, { kind: "export" });
  assert.equal(claimNext(db, "render", 1)?.id, a.id);
  assert.equal(claimNext(db, "render", 1)?.id, b.id);
  assert.equal(claimNext(db, "render", 1), undefined);
  assert.equal(countRunning(db, "render"), 2);
});

test("lane 互不干扰", () => {
  const db = fresh();
  enqueueJob(db, { kind: "upload" });
  assert.equal(claimNext(db, "render", 1), undefined);
  assert.equal(claimNext(db, "bili", 1)?.kind, "upload");
});

test("依赖未成功或 run_after 未到时不领取", () => {
  const db = fresh();
  const a = enqueueJob(db, { kind: "export" });
  const b = enqueueJob(db, { kind: "cover", dependsOn: [a.id] });
  const late = enqueueJob(db, { kind: "prepare", runAfter: 5000 });
  assert.equal(claimNext(db, "render", 100)?.id, a.id);
  assert.equal(claimNext(db, "render", 100), undefined);
  finishJob(db, a.id, { status: "succeeded" }, 200);
  assert.equal(claimNext(db, "render", 300)?.id, b.id);
  assert.equal(claimNext(db, "render", 300), undefined);
  assert.equal(claimNext(db, "render", 6000)?.id, late.id);
});

test("依赖失败会一路级联取消，已入队但不依赖它的不受影响", () => {
  const db = fresh();
  const e1 = enqueueJob(db, { kind: "export" });
  const u1 = enqueueJob(db, { kind: "upload", dependsOn: [e1.id] });
  const u2 = enqueueJob(db, { kind: "upload", dependsOn: [u1.id] });
  const free = enqueueJob(db, { kind: "upload" });
  claimNext(db, "render", 1);
  finishJob(db, e1.id, { status: "failed", error: "boom" }, 2);
  assert.equal(getJob(db, u1.id)?.status, "cancelled");
  assert.match(getJob(db, u1.id)?.error ?? "", /依赖失败: #1/);
  assert.equal(getJob(db, u2.id)?.status, "cancelled");
  assert.equal(getJob(db, free.id)?.status, "queued");
});

test("取消：排队直接取消，运行中先标记请求", () => {
  const db = fresh();
  const a = enqueueJob(db, { kind: "export" });
  const b = enqueueJob(db, { kind: "export" });
  claimNext(db, "render", 1);
  assert.equal(requestCancel(db, b.id, 2), "cancelled");
  assert.equal(requestCancel(db, a.id, 2), "requested");
  assert.deepEqual(cancelRequestedIds(db), [a.id]);
  assert.equal(requestCancel(db, a.id, 3), "noop");
});

test("重试：新建任务、改指依赖并复活被级联取消的后续任务", () => {
  const db = fresh();
  const e1 = enqueueJob(db, { kind: "export", payload: { x: 1 } });
  const u1 = enqueueJob(db, { kind: "upload", dependsOn: [e1.id] });
  const u2 = enqueueJob(db, { kind: "upload", dependsOn: [u1.id] });
  claimNext(db, "render", 1);
  finishJob(db, e1.id, { status: "failed", error: "boom" }, 2);
  const again = retryJob(db, e1.id, 3);
  assert.equal(again.retryOf, e1.id);
  assert.deepEqual(again.payload, { x: 1 });
  assert.deepEqual(getJob(db, u1.id)?.dependsOn, [again.id]);
  assert.equal(getJob(db, u1.id)?.status, "queued");
  assert.equal(getJob(db, u2.id)?.status, "queued");
  assert.throws(() => retryJob(db, again.id, 4), /只有失败/);
});

test("启动恢复：running 变 interrupted 并级联", () => {
  const db = fresh();
  const a = enqueueJob(db, { kind: "export" });
  const b = enqueueJob(db, { kind: "cover", dependsOn: [a.id] });
  claimNext(db, "render", 1);
  assert.equal(recoverInterrupted(db, 9), 1);
  assert.equal(getJob(db, a.id)?.status, "interrupted");
  assert.equal(getJob(db, b.id)?.status, "cancelled");
});

test("日志脱敏并只保留最近 N 行", () => {
  const db = fresh();
  const a = enqueueJob(db, { kind: "upload" });
  appendLogs(db, a.id, [{ stream: "stdout", line: "bili_jct=abc123 csrf=zzz" }], 1, 3);
  assert.equal(listLogs(db, a.id, 0)[0]?.line, "bili_jct=*** csrf=***");
  for (let i = 0; i < 10; i += 1) appendLogs(db, a.id, [{ stream: "stdout", line: `l${i}` }], 2, 3);
  assert.deepEqual(listLogs(db, a.id, 0).map((row) => row.line), ["l7", "l8", "l9"]);
});
