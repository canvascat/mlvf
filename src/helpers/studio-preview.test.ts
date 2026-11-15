import assert from "node:assert/strict";
import test from "node:test";
import { resolveStudioDefault } from "./studio-preview";

test("resolveStudioDefault 无 override 时返回内置默认", () => {
  const fallback = { songName: "内置" };
  assert.deepEqual(
    resolveStudioDefault("AMLLPlayer", fallback),
    fallback,
  );
});