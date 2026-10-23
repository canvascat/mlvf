import assert from "node:assert/strict";
import { test } from "node:test";
import { isLyricTimeSeek } from "./lyric-clock";

test("逐帧前进不算跳转，间奏三点才能沿歌曲时间演完", () => {
  assert.equal(isLyricTimeSeek(0, 0), false);
  assert.equal(isLyricTimeSeek(0, 33), false);
  assert.equal(isLyricTimeSeek(1000, 1016), false);
  assert.equal(isLyricTimeSeek(8000, 8200), false);
});

test("倒退或一次跨过多个帧才算跳转", () => {
  assert.equal(isLyricTimeSeek(5000, 4999), true);
  assert.equal(isLyricTimeSeek(1000, 1201), true);
  assert.equal(isLyricTimeSeek(0, 8000), true);
});
