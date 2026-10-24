import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLyricText } from "./lyrics";

const QRC = `[18644,3367]駄(18644,182)目(18826,188)
[22011,800]次(22011,800)
[rmv-translation]
[00:18.64]不行不行
[00:22.01]//
[rmv-roman]
[18644,3367]da (18644,182)me (18826,188)
`;

const KANA_QRC = `[kana:1かい1ぶつ1す1ば1せ1か(2964,296)い(3260,240)2きょう]
[0,666]怪(0,121)物(121,121)
[2128,2725]素(2128,14)晴(2142,50)ら(2192,360)し(2552,239)き(2791,94)世(2885,79)界(2964,536)に(3500,143)今日(3643,439)
`;

test("QRC 的中文挂到整行，罗马音挂到每个字", () => {
  const lines = parseLyricText(QRC, "qrc");
  assert.equal(lines.length, 2);
  assert.equal(lines[0]?.words.map((word) => word.word).join(""), "駄目");
  assert.equal(lines[0]?.translatedLyric, "不行不行");
  assert.equal(lines[0]?.romanLyric, "");
  assert.equal(lines[0]?.words[0]?.romanWord, "da");
  assert.equal(lines[0]?.words[1]?.romanWord, "me");
  assert.equal(lines[1]?.translatedLyric, "");
  assert.equal(lines[1]?.romanLyric, "");
  assert.equal(lines[1]?.words[0]?.romanWord, undefined);
});

const QRC_ZERO_SPACE = `[135838,3686]う(137036,448) (137484,0)背(137484,176)
[rmv-roman]
[135837,3686]u (137035,447)  (137483,0)se (137483,176)
`;

test("零时长空格不抢走紧挨着的罗马音", () => {
  const lines = parseLyricText(QRC_ZERO_SPACE, "qrc");
  const words = lines[0]?.words ?? [];
  const space = words.find((word) => word.word === " ");
  const back = words.find((word) => word.word === "背");
  assert.equal(space?.romanWord, undefined);
  assert.equal(back?.romanWord, "se");
});

test("QRC 的 kana 注音只挂到汉字上", () => {
  const lines = parseLyricText(KANA_QRC, "qrc");
  assert.equal(lines[0]?.words[0]?.ruby?.[0]?.word, "かい");
  assert.equal(lines[0]?.words[1]?.ruby?.[0]?.word, "ぶつ");
  assert.equal(lines[1]?.words[0]?.ruby?.[0]?.word, "す");
  assert.equal(lines[1]?.words[1]?.ruby?.[0]?.word, "ば");
  assert.equal(lines[1]?.words[2]?.ruby, undefined);
  assert.equal(lines[1]?.words[5]?.ruby?.[0]?.word, "せ");
  assert.deepEqual(
    lines[1]?.words[6]?.ruby?.map((ruby) => ruby.word),
    ["か", "い"],
  );
  assert.equal(lines[1]?.words[8]?.ruby?.[0]?.word, "きょう");
  assert.equal(lines[1]?.words[7]?.ruby, undefined);
});

const LRC_WITH_TRANSLATION = `[00:01.00]第一句
[00:05.00]第二句
[00:09.00]第三句
[rmv-translation]
[00:01.00]line one
[00:05.00]line two
`;

const YRC_WITH_TRANSLATION = `[1000,2000](1000,1000,0)甲(2000,1000,0)乙
[5000,2000](5000,1000,0)丙(6000,1000,0)丁
[rmv-translation]
[00:01.00]first
[00:05.00]second
`;

test("LRC 带翻译时挂到对应的歌词行，不会多出独立的翻译行", () => {
  const lines = parseLyricText(LRC_WITH_TRANSLATION, "lrc");
  assert.equal(lines.length, 3);
  assert.equal(lines[0]?.translatedLyric, "line one");
  assert.equal(lines[1]?.translatedLyric, "line two");
  assert.equal(lines[2]?.translatedLyric, "");
  assert.equal(lines[0]?.words.map((word) => word.word).join(""), "第一句");
});

test("YRC 逐字歌词带翻译时也挂到对应的歌词行", () => {
  const lines = parseLyricText(YRC_WITH_TRANSLATION, "yrc");
  assert.equal(lines.length, 2);
  assert.equal(lines[0]?.translatedLyric, "first");
  assert.equal(lines[1]?.translatedLyric, "second");
  assert.equal(lines[0]?.words.length, 2);
});

test("没有翻译标记的 LRC 和 YRC 行为不变", () => {
  assert.equal(
    parseLyricText("[00:01.00]第一句\n[00:05.00]第二句\n", "lrc").length,
    2,
  );
  assert.equal(
    parseLyricText("[1000,2000](1000,1000,0)甲(2000,1000,0)乙\n", "yrc")[0]
      ?.translatedLyric,
    "",
  );
});

test("对唱标记被去掉，并按段左右交替", () => {
  const lines = parseLyricText(
    [
      "[0,1000](0,100)方(100,100)：(200,100)开(300,200)个(500,200)玩(700,150)笑(850,150)",
      "[1000,800]别(1000,200)太(1200,200)认(1400,200)真(1600,200)",
      "[3000,800](3000,100)徐(3100,100)： (3200,100)我(3300,200)说(3500,200)",
      "[4000,400]男(4000,200)生(4200,200)",
      "[5000,800]合(5000,100)：(5100,100)是(5200,200)不(5400,200)是(5600,200)",
    ].join("\n"),
    "qrc",
  );
  assert.deepEqual(
    lines.map((line) => [
      line.words.map((word) => word.word).join(""),
      line.isDuet,
      line.startTime,
    ]),
    [
      ["开个玩笑", false, 300],
      ["别太认真", false, 1000],
      ["我说", true, 3300],
      ["男生", true, 4000],
      ["是不是", false, 5200],
    ],
  );
});
