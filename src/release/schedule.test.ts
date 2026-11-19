import assert from "node:assert/strict";
import { test } from "node:test";
import { nextUpload, UPLOAD_GAP_MS } from "./schedule";

const base = {
  mode: "and" as const,
  exportDone: false,
  uploading: false,
  now: 1_000_000,
  lastUploadOkAt: null as number | null,
  pendingReady: ["a"],
};

test("导出后上传要等全部导出完", () => {
  assert.equal(nextUpload({ ...base, mode: "then" }).type, "idle");
  assert.deepEqual(nextUpload({ ...base, mode: "then", exportDone: true }), { type: "upload", id: "a" });
});

test("导出并上传在间隔未满时等待，投稿中不并行", () => {
  assert.deepEqual(nextUpload(base), { type: "upload", id: "a" });
  assert.deepEqual(
    nextUpload({ ...base, lastUploadOkAt: base.now - 60_000, pendingReady: ["b"] }),
    { type: "wait", ms: UPLOAD_GAP_MS - 60_000 },
  );
  assert.equal(nextUpload({ ...base, uploading: true }).type, "idle");
  assert.equal(nextUpload({ ...base, pendingReady: [], exportDone: true }).type, "stop");
});
