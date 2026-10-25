import type { LyricLine } from "@applemusic-like-lyrics/core";
import assert from "node:assert/strict";
import { test } from "node:test";
import { stripLyricMetadata } from "./lyric-metadata";

function line(text: string, startMs = 0): LyricLine {
  return {
    words: [{ word: text, startTime: startMs, endTime: startMs + 500, obscene: false }],
    startTime: startMs,
    endTime: startMs + 500,
    translatedLyric: "",
    romanLyric: "",
    isBG: false,
    isDuet: false,
  };
}

function texts(lines: readonly LyricLine[]): string[] {
  return lines.map((item) => item.words.map((word) => word.word).join(""));
}

test("去掉开头的歌名歌手和词曲信息，以及结尾的制作人", () => {
  const cleaned = stripLyricMetadata(
    [
      line("IRIS OUT - 米津玄師 （よねづ けんし）"),
      line("词：米津玄師"),
      line("曲：米津玄師"),
      line("编曲：米津玄師"),
      line("制作人：米津玄師"),
      line("駄目駄目駄目", 18_000),
      line("制作人：米津玄師", 140_000),
    ],
    { title: "IRIS OUT", artists: "米津玄師" },
  );
  assert.deepEqual(texts(cleaned), ["駄目駄目駄目"]);
});

test("正文里的冒号句保留", () => {
  const cleaned = stripLyricMetadata(
    [line("君：好きだ"), line("駄目駄目駄目"), line("曲终")],
    { title: "IRIS OUT", artists: "米津玄師" },
  );
  assert.deepEqual(texts(cleaned), ["君：好きだ", "駄目駄目駄目", "曲终"]);
});

test("去掉开头的演奏录音署名，保留后面的歌词", () => {
  const cleaned = stripLyricMetadata(
    [
      line("花海 - 周杰伦 （Jay Chou）"),
      line("词：古小力/黄淩嘉"),
      line("曲：周杰伦"),
      line("编曲：黄雨勋"),
      line("制作人：周杰伦"),
      line("吉他：李庭匡"),
      line("录音师：杨瑞代"),
      line("录音室：JVR Studio"),
      line("混音师：杨大纬"),
      line("混音室：杨大纬工作室"),
      line("OP：JVR Music Int'l Ltd."),
      line("静止了所有的花开"),
      line("遥远了清晰了爱"),
    ],
    { title: "花海", artists: "周杰伦" },
  );
  assert.deepEqual(texts(cleaned), ["静止了所有的花开", "遥远了清晰了爱"]);
});

test("去掉结尾的演奏名单，保留对白和合唱标记", () => {
  const cleaned = stripLyricMetadata(
    [
      line("词：方文山"),
      line("巨炮：哈哈哈哈哈哈哈"),
      line("杰伦：小傻瓜 这不是大提琴"),
      line("男：尼罗河悄悄漫过纸莎草"),
      line("女：黄昏"),
      line("合：用一生去等待"),
      line("很少笑 吃全麦的面包"),
      line("制作人：周杰伦"),
      line("合声编写：周杰伦"),
      line("合声：周杰伦"),
      line("弦乐：1st Violin：陈允 / 吴阳"),
      line("2nd Violin：李培彦 / 刘玉琪"),
      line("Cello：关大伟"),
      line("Bass：勋士岐 / 曹辉"),
      line("四重奏：1st 陈允 2nd 曾诚"),
      line("录音工程：杨瑞代"),
      line("混音助理：刘勇志"),
      line("乌克丽丽：林迈可"),
    ],
    { title: "花海", artists: "周杰伦" },
  );
  assert.deepEqual(texts(cleaned), [
    "巨炮：哈哈哈哈哈哈哈",
    "杰伦：小傻瓜 这不是大提琴",
    "男：尼罗河悄悄漫过纸莎草",
    "女：黄昏",
    "合：用一生去等待",
    "很少笑 吃全麦的面包",
  ]);
});

test("去掉开头用和连接的制作署名和母带处理", () => {
  const cleaned = stripLyricMetadata(
    [
      line("江湖中人 - 方大同"),
      line("曲：方大同"),
      line("词：方大同"),
      line("制作和编曲：方大同"),
      line("所有乐器和编程：Soulboy"),
      line("数字编辑：Jeff Li"),
      line("混音：Eric Lau"),
      line("母带处理：Randy Merrill@Sterling Sound"),
      line("帽子落在他下巴"),
      line("桌面卧着剑一把"),
    ],
    { title: "江湖中人", artists: "方大同" },
  );
  assert.deepEqual(texts(cleaned), ["帽子落在他下巴", "桌面卧着剑一把"]);
});

test("角色词只是前缀时保留歌词", () => {
  const cleaned = stripLyricMetadata([
    line("词汇：还没到"),
    line("鼓声：咚咚"),
    line("室内：很安静"),
    line("原来：你还在"),
    line("曲终"),
  ]);
  assert.deepEqual(texts(cleaned), [
    "词汇：还没到",
    "鼓声：咚咚",
    "室内：很安静",
    "原来：你还在",
    "曲终",
  ]);
});
