import assert from "node:assert/strict";
import { test } from "node:test";
import { parseReleaseArgs } from "./cli";

test("导出并上传收下备料目录", () => {
  assert.deepEqual(parseReleaseArgs(["export-and-upload", "预处理/寻雾"]), {
    command: "export-and-upload",
    target: "预处理/寻雾",
    overwriteVideo: false,
  });
});
