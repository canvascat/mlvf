import assert from "node:assert/strict";
import { test } from "node:test";
import { bvidFrom, classifyUpload } from "./upload-result";

test("文件大小里的 21566 不当成限流", () => {
  const output = "size 2156600\nWeb 接口投稿成功\nBV1YosU6REFN";
  assert.equal(classifyUpload(0, output, false), "ok");
  assert.equal(bvidFrom(output), "BV1YosU6REFN");
});

test("21566 先重试，隔过间隔后改草稿", () => {
  const output = "code 21566 投稿过于频繁";
  assert.equal(classifyUpload(1, output, false), "retry");
  assert.equal(classifyUpload(1, output, true), "draft");
  assert.equal(classifyUpload(1, "code 137022", false), "draft");
});
