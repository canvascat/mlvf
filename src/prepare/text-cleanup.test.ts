import assert from "node:assert/strict";
import { test } from "node:test";
import {
  kanaTagIsCorrupt,
  prepareDisplayText,
  repairLegacyChinese,
  sanitizeLyric,
} from "./text-cleanup";

test("Latin-1 读出的 GBK 还原成汉字", () => {
  const mojibake = String.fromCharCode(0xd6, 0xdc, 0xbd, 0xdc, 0xc2, 0xd7);
  assert.equal(repairLegacyChinese(mojibake), "周杰伦");
  assert.equal(repairLegacyChinese("周杰伦"), "周杰伦");
  assert.equal(repairLegacyChinese("Jay Chou"), "Jay Chou");
});

test("没有假名的繁体转成简体，日文歌词保持原文", () => {
  assert.equal(prepareDisplayText("織田哲郎"), "织田哲郎");
  assert.equal(prepareDisplayText("這是繁體歌詞"), "这是繁体歌词");
  assert.equal(prepareDisplayText("負けないで"), "負けないで");
  assert.equal(
    prepareDisplayText("ZARD BEST The Single Collection ～軌跡～"),
    "ZARD BEST The Single Collection ～轨迹～",
  );
});

test("坏掉的假名注音整行丢掉，完好的注音保留", () => {
  assert.equal(kanaTagIsCorrupt("[kana:1ま11111し1さか]"), true);
  assert.equal(kanaTagIsCorrupt("[kana:1ゆ1おも1し(3248,89)ょ]"), false);
  const cleaned = sanitizeLyric(
    "[kana:1ま11111し1さか]\n[0,1000]負けないで\n[ti:這首歌]",
  );
  assert.equal(cleaned, "[0,1000]負けないで\n[ti:这首歌]");
});
