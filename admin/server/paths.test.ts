import assert from "node:assert/strict";
import { test } from "node:test";
import { assertInside } from "./paths";

test("白名单内的路径返回绝对路径，越界和 .. 逃逸都拒绝", () => {
  assert.equal(assertInside("/proj/预处理", "/proj/预处理/寻雾"), "/proj/预处理/寻雾");
  assert.throws(() => assertInside("/proj/预处理", "/etc/passwd"), /不在允许范围/);
  assert.throws(() => assertInside("/proj/预处理", "/proj/预处理/../out"), /不在允许范围/);
  assert.throws(() => assertInside("/proj/预处理", "/proj/预处理x"), /不在允许范围/);
});
