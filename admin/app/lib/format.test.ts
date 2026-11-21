import assert from "node:assert/strict";
import { test } from "node:test";
import { formatBytes, formatDuration, formatTime, jobKindLabel, jobStatusLabel } from "./format";

test("时长按有无小时显示", () => {
  assert.equal(formatDuration(65), "1:05");
  assert.equal(formatDuration(3725), "1:02:05");
  assert.equal(formatDuration(null), "—");
});

test("字节数用合适单位", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(5 * 1024 ** 3), "5.0 GB");
  assert.equal(formatBytes(null), "—");
});

test("时间固定按上海时区显示", () => {
  assert.equal(formatTime(Date.UTC(2026, 10, 21, 16, 5, 9)), "2026-11-22 00:05:09");
  assert.equal(formatTime(null), "—");
});

test("任务种类与状态有中文名，未知值原样返回", () => {
  assert.equal(jobKindLabel("export"), "导出");
  assert.equal(jobKindLabel("publish_draft"), "发布草稿");
  assert.equal(jobStatusLabel("cancel_requested"), "取消中");
  assert.equal(jobStatusLabel("weird"), "weird");
});
