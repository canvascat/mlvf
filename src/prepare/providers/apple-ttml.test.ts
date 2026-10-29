import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyReplacementTranslations,
  artistForMatch,
  expandSearchKeywords,
  isSyllableTtml,
  mergeAppleSongs,
  orderAppleSongs,
  pickTtml,
  preferSingleTwins,
  type AppleSong,
} from "./apple-ttml";
import { readAppleMusicAuth } from "./apple-music-auth";
import type { TrackQuery } from "../types";

const query: TrackQuery = {
  title: "我愿意",
  artist: "王菲",
  album: "菲卖品",
  durationMs: 274_000,
};

function song(partial: Partial<AppleSong> & Pick<AppleSong, "id">): AppleSong {
  return {
    name: "我愿意",
    singer: "王菲",
    album: "菲卖品",
    durationMs: 274_000,
    storefront: "cn",
    isrc: "",
    hasTimeSyncedLyrics: false,
    hasLyrics: true,
    inAccount: false,
    ...partial,
  };
}

test("没有 Media-User-Token 时不启用 Apple Music", () => {
  assert.equal(readAppleMusicAuth({}), null);
  assert.equal(readAppleMusicAuth({ MEDIA_USER_TOKEN: "  " }), null);
});

test("从环境变量读出 Media-User-Token", () => {
  assert.deepEqual(
    readAppleMusicAuth({
      MEDIA_USER_TOKEN: "token",
      APPLE_MUSIC_STOREFRONT: "CN",
    }),
    { mediaUserToken: "token", storefront: "cn" },
  );
});

test("歌手别名会扩出另一套搜索词", () => {
  assert.deepEqual(expandSearchKeywords("倔强 五月天"), ["倔强 五月天", "倔强 Mayday"]);
});

test("曲名对上时把关键词里的歌手补进候选", () => {
  const matched = artistForMatch(
    "我愿意 王菲",
    song({ id: "1", singer: "Faye Wong" }),
  );
  assert.match(matched, /王菲/);
});

test("外区曲目用 ISRC 对到账号曲库", () => {
  const merged = mergeAppleSongs(
    [
      song({
        id: "jp-1",
        storefront: "jp",
        isrc: "ABC",
        name: "I'm Willing",
        singer: "Faye Wong",
      }),
      song({ id: "cn-1", storefront: "cn", isrc: "ABC", hasTimeSyncedLyrics: true }),
    ],
    "cn",
    "我愿意 王菲",
  );
  const foreign = merged.find((item) => item.id === "jp-1");
  assert.equal(foreign?.accountId, "cn-1");
  assert.equal(merged.find((item) => item.id === "cn-1")?.inAccount, true);
});

test("同一首歌优先逐字和 Single，现场版靠后", () => {
  const ordered = orderAppleSongs(
    [
      song({ id: "live", name: "我愿意 (Live)", album: "Live", hasTimeSyncedLyrics: true }),
      song({ id: "album", album: "菲卖品", hasTimeSyncedLyrics: false }),
      song({
        id: "single",
        album: "我愿意 - Single",
        hasTimeSyncedLyrics: true,
      }),
    ],
    query,
    "我愿意 王菲",
  );
  assert.deepEqual(
    ordered.map((item) => item.id),
    ["single", "album", "live"],
  );
});

test("孪生版本把 Single 排在专辑前面", () => {
  const ordered = preferSingleTwins([
    song({ id: "album", album: "菲卖品" }),
    song({ id: "single", album: "我愿意 - Single" }),
  ]);
  assert.equal(ordered[0]?.id, "single");
});

test("带 begin 的 span 才算逐字", () => {
  assert.equal(isSyllableTtml('<span begin="0s">爱</span>'), true);
  assert.equal(isSyllableTtml("<p begin=\"0s\">爱</p>"), false);
});

test("简体替换段按 itunes:key 融进主歌词", () => {
  const ttml = `
<tt xml:lang="ja" xmlns="http://www.w3.org/ns/ttml">
  <body><div>
    <p begin="0s" end="1s" itunes:key="L1">あ<span begin="0s" end="1s">い</span></p>
  </div></body>
  <translations>
    <translation type="replacement" xml:lang="zh-Hans">
      <text for="L1"><span begin="0s" end="1s" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">爱</span></text>
    </translation>
  </translations>
</tt>`;
  const merged = applyReplacementTranslations(ttml);
  assert.match(merged, /<p begin="0s" end="1s" itunes:key="L1"><span begin="0s" end="1s">爱<\/span><\/p>/);
  assert.doesNotMatch(merged, /type="replacement"/);
  assert.doesNotMatch(merged, /xmlns:ttm/);
  assert.match(merged, /xml:lang="zh-Hans"/);
  assert.equal(isSyllableTtml(merged), true);
});

test("歌词响应优先用本地化 TTML", () => {
  assert.equal(
    pickTtml({
      data: [
        {
          attributes: {
            ttml: "<tt>原文</tt>",
            ttmlLocalizations: "<tt>简体</tt>",
          },
        },
      ],
    }),
    "<tt>简体</tt>",
  );
});
