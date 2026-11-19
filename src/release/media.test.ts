import assert from "node:assert/strict";
import { test } from "node:test";
import { albumDynamic, dynamicForTrack, hiresFor } from "./media";

test("44.1/16 不开 Hi-Res，96k 无损才开", () => {
  assert.equal(hiresFor({ lossless: true, sampleRate: 44100, bitsPerSample: 16 }), 0);
  assert.equal(hiresFor({ lossless: true, sampleRate: 96000, bitsPerSample: 24 }), 1);
  assert.equal(hiresFor({ lossless: false, sampleRate: 96000, bitsPerSample: 24 }), 0);
});

test("动态只给第一首，本批已有动态则不再写", () => {
  assert.equal(dynamicForTrack(1, "许嵩", "寻雾启示", false), albumDynamic("许嵩", "寻雾启示"));
  assert.equal(dynamicForTrack(2, "许嵩", "寻雾启示", false), "");
  assert.equal(dynamicForTrack(1, "许嵩", "寻雾启示", true), "");
});
