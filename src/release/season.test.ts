import assert from "node:assert/strict";
import { test } from "node:test";
import { classifySeasonAdd } from "./season";

test("新稿件查不到和编辑过于频繁都要重试这一次", () => {
  assert.equal(classifySeasonAdd(0, "已将 1 个稿件加入小节 1"), "ok");
  assert.equal(classifySeasonAdd(1, "code 256000"), "wait-rate");
  assert.equal(classifySeasonAdd(1, "code -404, message 啥都木有"), "wait-missing");
  assert.equal(classifySeasonAdd(1, "code 20092"), "fail");
});
