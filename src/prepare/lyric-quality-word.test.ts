import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasWordLevelTiming,
  isSyllableTtml,
} from "./lyric-quality";

test("逐行 Apple TTML 不算真逐字", () => {
  const lineOnly =
    '<tt xmlns="http://www.w3.org/ns/ttml" itunes:timing="Line"><body><p begin="1s" end="2s">你好</p></body></tt>';
  assert.equal(isSyllableTtml(lineOnly), false);
  assert.equal(hasWordLevelTiming(lineOnly, "ttml"), false);
});

test("带 span 的 TTML 算真逐字", () => {
  const syllable = '<span begin="0s">你</span><span begin="0.2s">好</span>';
  assert.equal(hasWordLevelTiming(syllable, "ttml"), true);
});