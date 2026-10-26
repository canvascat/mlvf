import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildVideoBlurb,
  formatClock,
  parseCreditLines,
  repairLegacyChinese,
} from "./video-blurb";

test("时长按秒四舍五入", () => {
  assert.equal(formatClock(228.64), "3:49");
});

test("繁体署名转成简体", () => {
  const credits = parseCreditLines("作詞：織田哲郎\n編曲：明石昌夫\n");
  assert.deepEqual(credits, [
    { role: "词", name: "织田哲郎" },
    { role: "编曲", name: "明石昌夫" },
  ]);
});

test("歌词头里的词曲编曲可以解析", () => {
  const credits = parseCreditLines(
    "[00:18.14]词：黄俊郎\n[00:23.81]曲：周杰伦\n[00:29.48]编曲：钟兴民/林迈可\n作词：方文山\n制作人：周杰伦\n",
  );
  assert.deepEqual(credits, [
    { role: "词", name: "黄俊郎" },
    { role: "曲", name: "周杰伦" },
    { role: "编曲", name: "钟兴民、林迈可" },
    { role: "词", name: "方文山" },
    { role: "制作人", name: "周杰伦" },
  ]);
});

test("Latin-1 读出的 GBK 歌手名还原成汉字", () => {
  const mojibake = String.fromCharCode(0xd6, 0xdc, 0xbd, 0xdc, 0xc2, 0xd7);
  assert.equal(repairLegacyChinese(mojibake), "周杰伦");
  assert.equal(repairLegacyChinese("周杰伦"), "周杰伦");
  assert.equal(repairLegacyChinese("Jay Chou"), "Jay Chou");
});

test("标题带歌手歌名和专辑，简介不写偏移", () => {
  const blurb = buildVideoBlurb({
    songName: "夜的第七章",
    artists: ["周杰伦", "潘儿"],
    albumName: "依然范特西",
    releaseDate: "2006-09-05",
    genre: "国语流行",
    credits: [{ role: "词", name: "黄俊郎" }],
    sampleRate: 44100,
    bitsPerSample: 24,
    channels: 2,
    durationSeconds: 228.64,
  });
  assert.equal(blurb.title, "周杰伦、潘儿《夜的第七章》｜依然范特西");
  assert.match(blurb.description, /2006年9月5日发行/);
  assert.match(blurb.description, /44\.1 kHz \/ 24 bit/);
  assert.doesNotMatch(blurb.description, /偏移/);
});
