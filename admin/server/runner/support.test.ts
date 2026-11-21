import assert from "node:assert/strict";
import { test } from "node:test";
import { openDb } from "../db/client";
import { acquireRunnerLock, releaseRunnerLock, runnerOnline } from "./lock";
import { isProgressLine, parseRenderProgress } from "./progress";

test("解析 remotion 的三种输出", () => {
  assert.equal(parseRenderProgress("Bundling 100%"), 0.05);
  assert.equal(parseRenderProgress("Rendered 0/8056"), 0.05);
  assert.equal(parseRenderProgress("Rendered 4028/8056, time remaining: 1m"), 0.475);
  assert.equal(parseRenderProgress("Rendered 8056/8056"), 0.9);
  assert.equal(parseRenderProgress("Encoded 88/8056"), null);
  assert.equal(parseRenderProgress("正在渲染无声画面"), null);
  assert.equal(isProgressLine("Encoded 88/8056"), true);
  assert.equal(isProgressLine("Composition  AMLLPlayer"), false);
});

test("runner 单实例锁：同一进程可重入，别的活进程占用时拒绝，过期可接管", () => {
  const db = openDb(":memory:");
  assert.equal(acquireRunnerLock(db, process.pid, 1000), true);
  assert.equal(acquireRunnerLock(db, process.pid, 2000), true);
  assert.equal(acquireRunnerLock(db, 999_999, 3000), false);
  assert.equal(acquireRunnerLock(db, 999_999, 3000 + 20_000), true);
  releaseRunnerLock(db, 999_999);
  assert.equal(runnerOnline(null, 1), false);
  assert.equal(runnerOnline(1000, 5000), true);
});
