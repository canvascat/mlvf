import assert from "node:assert/strict";
import { test } from "node:test";
import {
  albumNamesMatch,
  parseLyricFormatPreference,
  pickBestCandidate,
  pickBestLyric,
  needsLyricAlign,
  shouldSearchLyrics,
} from "./match";
import type { LyricCandidate, ProviderLyric, TrackQuery } from "./types";

const query: TrackQuery = {
  title: "我愿意",
  artist: "王菲",
  album: "菲卖品 王菲精选",
  durationMs: 274_000,
};

function candidate(partial: Partial<LyricCandidate>): LyricCandidate {
  return {
    name: "我愿意",
    artist: "王菲",
    ...partial,
  };
}

function hit(
  format: ProviderLyric["format"],
  partial: Partial<LyricCandidate>,
  source: ProviderLyric["source"] = "netease",
): ProviderLyric {
  return {
    source,
    format,
    content: "[00:00.00]test",
    candidate: candidate(partial),
  };
}

test("专辑名忽略空格和波浪号", () => {
  assert.equal(
    albumNamesMatch(
      "ZARD BEST The Single Collection ～軌跡～",
      "ZARD BEST The  Single  Collection  ～軌跡～",
    ),
    true,
  );
  assert.equal(
    albumNamesMatch(
      "ZARD BEST The Single Collection ～軌跡～",
      "負けないで",
    ),
    false,
  );
  assert.equal(
    albumNamesMatch(
      "ZARD BEST The Single Collection ～軌跡～",
      "ZARD Best Request ～35th Anniversary～",
    ),
    false,
  );
});

test("跨源选词时，时长更接近的版本压过更好的歌词格式", () => {
  const chosen = pickBestLyric(
    [
      hit("yrc", { album: "随便看看", duration: 320_000 }),
      hit("lrc", { album: "菲卖品 王菲精选", duration: 274_500 }, "lrclib"),
    ],
    query,
  );
  assert.equal(chosen?.format, "lrc");
  assert.equal(chosen?.candidate.duration, 274_500);
});

test("都在可接受时长内时，逐字歌词压过更贴时长的整行歌词", () => {
  const chosen = pickBestLyric(
    [
      hit("lrc", { duration: 274_000 }, "embedded"),
      hit("yrc", { duration: 269_000 }, "kugou"),
    ],
    query,
  );
  assert.equal(chosen?.format, "yrc");
  assert.equal(chosen?.source, "kugou");
});

test("时长同样接近时，才用更好的歌词格式", () => {
  const chosen = pickBestLyric(
    [
      hit("lrc", { duration: 273_000 }, "lrclib"),
      hit("yrc", { duration: 274_200 }),
    ],
    query,
  );
  assert.equal(chosen?.format, "yrc");
});

test("括号里的译名和合作者名单不挡住同一首歌", () => {
  const remix = pickBestCandidate(
    [
      candidate({
        name: "運命のルーレット廻して (转动命运之轮)",
        artist: "ZARD",
        album: "永遠",
        duration: 319_000,
      }),
      candidate({
        name: "運命のルーレット廻して (转动命运之轮) (Re-mix Version)",
        artist: "ZARD",
        album: "ZARD BEST The Single Collection ～軌跡～",
        duration: 315_000,
      }),
    ],
    {
      title: "運命のルーレット廻して (Re-mix Version)",
      artist: "ZARD",
      album: "ZARD BEST The Single Collection ～軌跡～",
      durationMs: 314_650,
    },
  );
  assert.equal(remix?.duration, 315_000);

  const dream = pickBestCandidate(
    [
      candidate({
        name: "果てしない夢を",
        artist: "ZYYG/REV/ZARD/WANDS/長嶋茂雄",
        duration: 293_000,
      }),
    ],
    {
      title: "果てしない夢を (ZYYG,REV,ZARD & WANDS featuring 長嶋茂雄)",
      artist: "ZARD",
      album: "ZARD BEST The Single Collection ～軌跡～",
      durationMs: 287_530,
    },
  );
  assert.equal(dream?.name, "果てしない夢を");
});

test("同一源里也优先时长接近的候选", () => {
  const chosen = pickBestCandidate(
    [
      candidate({ album: "浮躁", duration: 321_000 }),
      candidate({ album: "菲卖品 王菲精选", duration: 275_000 }),
    ],
    query,
  );
  assert.equal(chosen?.duration, 275_000);
});

test("时长差超过 5 秒才需要自动偏移", () => {
  assert.equal(
    needsLyricAlign(candidate({ duration: 274_200 }), query),
    false,
  );
  assert.equal(
    needsLyricAlign(candidate({ duration: 290_000 }), query),
    true,
  );
});

test("内嵌 lrc 仍要联网找更高优先级格式", () => {
  assert.equal(shouldSearchLyrics({ format: "lrc" }), true);
  assert.equal(shouldSearchLyrics({ format: "yrc" }), true);
  assert.equal(shouldSearchLyrics(undefined), true);
});

test("指定 krc 时，酷狗逐字压过更贴时长的其它歌词", () => {
  const chosen = pickBestLyric(
    [
      hit("yrc", { duration: 274_000 }, "netease"),
      hit("ttml", { duration: 274_000 }, "amll-ttml"),
      hit("lrc", { duration: 274_000 }, "kugou"),
      hit("yrc", { duration: 260_000 }, "kugou"),
    ],
    query,
    "krc",
  );
  assert.equal(chosen?.source, "kugou");
  assert.equal(chosen?.format, "yrc");
});

test("指定 yrc 时，yrc 压过同时长的 ttml", () => {
  const chosen = pickBestLyric(
    [
      hit("ttml", { duration: 274_000 }, "amll-ttml"),
      hit("yrc", { duration: 274_000 }, "netease"),
    ],
    query,
    "yrc",
  );
  assert.equal(chosen?.format, "yrc");
  assert.equal(chosen?.source, "netease");
});

test("指定的格式一份都没有时退回默认选择", () => {
  const chosen = pickBestLyric(
    [
      hit("lrc", { duration: 274_000 }, "lrclib"),
      hit("ttml", { duration: 273_500 }, "amll-ttml"),
    ],
    query,
    "krc",
  );
  assert.equal(chosen?.format, "ttml");
});

test("歌词格式参数接受 krc，不认识的格式会报错", () => {
  assert.equal(parseLyricFormatPreference("KRC"), "krc");
  assert.throws(() => parseLyricFormatPreference("srt"), /不支持的歌词格式/);
});

test("已经有 ttml 才跳过歌词搜索", () => {
  assert.equal(shouldSearchLyrics({ format: "ttml" }), false);
});

test("默认同 splayer：更高格式压过更贴时长的低格式", () => {
  const all = pickBestLyric(
    [
      hit("yrc", { duration: 274_000 }, "netease"),
      hit("yrc", { duration: 270_000 }, "kugou"),
      hit("qrc", { duration: 269_000 }, "qqmusic"),
      hit("lys", { duration: 268_000 }, "qqmusic"),
      hit("ttml", { duration: 267_000 }, "amll-ttml"),
    ],
    query,
  );
  assert.equal(all?.format, "ttml");

  const withoutTtml = pickBestLyric(
    [
      hit("yrc", { duration: 274_000 }, "netease"),
      hit("qrc", { duration: 269_000 }, "qqmusic"),
    ],
    query,
  );
  assert.equal(withoutTtml?.format, "qrc");

  const withoutQrc = pickBestLyric(
    [
      hit("yrc", { duration: 274_000 }, "netease"),
      hit("yrc", { duration: 269_000 }, "kugou"),
    ],
    query,
  );
  assert.equal(withoutQrc?.source, "kugou");
});

test("时长接近时 ttml 压过内嵌 lrc", () => {
  const chosen = pickBestLyric(
    [
      hit("lrc", { duration: 274_000 }, "embedded"),
      hit("ttml", { duration: 273_500 }, "amll-ttml"),
    ],
    query,
  );
  assert.equal(chosen?.format, "ttml");
  assert.equal(chosen?.source, "amll-ttml");
});
