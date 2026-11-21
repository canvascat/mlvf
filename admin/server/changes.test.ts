import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { openDb } from "./db/client";
import { appendLogs, enqueueJob } from "./jobs";
import { pollJobChanges, pollLogs } from "./changes";

test("先给出已有变化，之后只给新变化，中止后结束", async () => {
  const db = openDb(":memory:");
  const a = enqueueJob(db, { kind: "export" }, 100);
  const controller = new AbortController();
  const seen: number[][] = [];
  const done = (async () => {
    for await (const batch of pollJobChanges(db, controller.signal, { since: 0, pollMs: 10 })) {
      seen.push(batch.map((job) => job.id));
      if (seen.length === 2) controller.abort();
    }
  })();
  await delay(60);
  const b = enqueueJob(db, { kind: "export" }, 200);
  await done;
  assert.deepEqual(seen, [[a.id], [b.id]]);
});

test("日志只给 afterId 之后的新行", async () => {
  const db = openDb(":memory:");
  const job = enqueueJob(db, { kind: "export" }, 1);
  appendLogs(db, job.id, [{ stream: "stdout", line: "one" }], 2, 100);
  const controller = new AbortController();
  const seen: string[][] = [];
  const done = (async () => {
    for await (const rows of pollLogs(db, job.id, 0, controller.signal, 10)) {
      seen.push(rows.map((row) => row.line));
      if (seen.length === 2) controller.abort();
    }
  })();
  await delay(60);
  appendLogs(db, job.id, [{ stream: "stderr", line: "two" }], 3, 100);
  await done;
  assert.deepEqual(seen, [["one"], ["two"]]);
});
