import type { LyricLine } from "@applemusic-like-lyrics/core";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { addConfirmedCreditKeys } from "./confirmed-credit-rules";
import {
  dropConfirmedCreditKeys,
  stripLyricMetadata,
} from "./lyric-metadata";
import {
  findSuspectedEdgeCredits,
  formatEdgeCreditReport,
  isSuspectedEdgeCreditLine,
} from "./lyric-edge-credits";

function line(text: string): LyricLine {
  return {
    words: [{ word: text, startTime: 0, endTime: 500, obscene: false }],
    startTime: 0,
    endTime: 500,
    translatedLyric: "",
    romanLyric: "",
    isBG: false,
    isDuet: false,
  };
}

function texts(lines: readonly LyricLine[]): string[] {
  return lines.map((item) => item.words.map((word) => word.word).join(""));
}

test("首尾署名算疑似，对白和钟点不算", () => {
  const suspected = [
    "低音吉他 Bass：Paul Bushnell",
    "吉他/曼陀铃Mandolin and all guitars：Andrew Synowiec",
    "键盘乐器 Keyboards (Piano and B3)by：Jeff Babko",
    "和声 Background Vocals by：DT",
    "弦乐编写 Cello arranged by：Goh Kheng Long/DT",
    "大提琴 Cello solo：Bela Gal",
    "制作协力 Production Assistant：陈震豪 Evan Chen",
    "母带后期工程师 Mastering Engineer：Dave Collins",
    "母带后期处理录音室 Mastering Studio：Dave Collins Mastering",
    "版权声明：未经著作权人书面许可，任何人不得以任何方式使用",
    "主音吉它：Eddie",
    "中国大鼓/打击乐：张永光（三儿）",
    "交响乐团：北京交响乐团",
    "监：Edward Chan/Charles Lee/方大同",
    "合音：黄秀侦/罗添洲/凌伟文",
    "专辑制作人Producer：钟成虎 Tiger Chung",
    "Recorded & Mixed by : John Lin - Studio S&R",
    "西塔琴 Coral sitar：Jamie Wilson",
    "中国鼓鼓手：郑萦珂/蔡姗珊",
    "管弦乐编曲：无",
    "编曲制作人Arranging Producer：陈绮贞 Cheer Chen/钟成虎Tiger Chung",
    "母带后制处理录音室：钰德科技份有限公司",
  ];
  const lyrics = [
    "周：屋檐如悬崖",
    "男：周末守着烤箱",
    "巨炮：哈哈哈哈哈哈哈",
    "方：You are the sunshine of my life",
    "张：Oh ah e yeah",
    "10:30的飞机快要到了",
    "1:30的我在回家路上",
    "词汇：还没到",
    "鼓声：咚咚",
    "室内：很安静",
    "原来：你还在",
    "君：好きだ",
    "菲：行弧步转圈",
    "梅：你一出世经已被看",
    "走吧 走吧 别再想",
    "She told my baby we'd danced 'til 3:00, then she looked at me",
  ];
  for (const text of suspected) {
    assert.equal(isSuspectedEdgeCreditLine(text), true, text);
  }
  for (const text of lyrics) {
    assert.equal(isSuspectedEdgeCreditLine(text), false, text);
  }
});

test("只取过滤后首尾连续的疑似行", () => {
  const found = findSuspectedEdgeCredits(
    [
      line("路上 - 陶喆"),
      line("词：陶喆"),
      line("低音吉他 Bass：Paul Bushnell"),
      line("制作协力 Production Assistant：陈震豪 Evan Chen"),
      line("走吧 走吧 别再想"),
      line("周：屋檐如悬崖"),
      line("版权声明：未经著作权人书面许可"),
    ],
    { title: "路上", artists: "陶喆" },
  );
  assert.deepEqual(found, [
    "低音吉他 Bass：Paul Bushnell",
    "制作协力 Production Assistant：陈震豪 Evan Chen",
    "版权声明：未经著作权人书面许可",
  ]);
});

test("署名名单中间认不全的行也一起报", () => {
  const found = findSuspectedEdgeCredits([
    line("管弦乐编曲：无"),
    line("西塔琴 Coral sitar：Jamie Wilson"),
    line("主音吉它：Eddie"),
    line("并不可惜"),
  ]);
  assert.deepEqual(found, [
    "管弦乐编曲：无",
    "西塔琴 Coral sitar：Jamie Wilson",
    "主音吉它：Eddie",
  ]);
});

test("开头对白会挡住后面的署名，正文中间的冒号行不报", () => {
  const found = findSuspectedEdgeCredits([
    line("周：屋檐如悬崖"),
    line("低音吉他 Bass：Paul Bushnell"),
    line("风铃如沧海"),
  ]);
  assert.deepEqual(found, []);
});

test("确认后的署名键写入规则，同样的键以后直接去掉", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "credit-keys-")), "keys.json");
  const added = addConfirmedCreditKeys(
    ["低音吉他 Bass：Paul Bushnell", "版权声明：未经著作权人书面许可"],
    file,
  );
  try {
    assert.deepEqual(added, ["低音吉他 Bass", "版权声明"]);
    const saved = JSON.parse(readFileSync(file, "utf8")) as { keys: string[] };
    assert.deepEqual(new Set(saved.keys), new Set(["低音吉他bass", "版权声明"]));
    const cleaned = stripLyricMetadata([
      line("低音吉他 Bass：Chris Chaney"),
      line("走吧 走吧"),
      line("版权声明：未经著作权人书面许可，请勿翻唱"),
    ]);
    assert.deepEqual(texts(cleaned), ["走吧 走吧"]);
    assert.deepEqual(
      findSuspectedEdgeCredits([
        line("低音吉他 Bass：Chris Chaney"),
        line("走吧 走吧"),
      ]),
      [],
    );
    assert.deepEqual(
      addConfirmedCreditKeys(["低音吉他 Bass：另一人"], file),
      [],
    );
  } finally {
    dropConfirmedCreditKeys(added);
  }
});

test("疑似行的提示写明还没加入规则", () => {
  const report = formatEdgeCreditReport("路上", [
    "低音吉他 Bass：Paul Bushnell",
  ]);
  assert.match(report, /《路上》/);
  assert.match(report, /低音吉他 Bass：Paul Bushnell/);
  assert.match(report, /未加入默认规则/);
  assert.match(report, /--accept-edge-credits/);
});
