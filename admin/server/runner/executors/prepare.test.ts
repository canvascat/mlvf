import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPrepareArgs } from "./prepare";

test("只带必填项", () => {
  assert.deepEqual(buildPrepareArgs({ audio: "/d/a.flac" }), ["src/prepare/cli.ts", "--audio", "/d/a.flac"]);
});

test("可选项按 CLI 的参数名展开", () => {
  assert.deepEqual(
    buildPrepareArgs({
      audio: "/d/a.flac", out: "/o", title: "歌", artist: "手", album: "辑",
      lyricOffsetMs: -200, acceptEdgeCredits: true, lyricFormat: "krc",
    }),
    [
      "src/prepare/cli.ts", "--audio", "/d/a.flac", "--out", "/o",
      "--title", "歌", "--artist", "手", "--album", "辑",
      "--lyric-offset", "-200", "--accept-edge-credits", "--lyric-format", "krc",
    ],
  );
});

test("偏移为 0 也要传（0 是确认过的值）", () => {
  assert.ok(buildPrepareArgs({ audio: "/d/a.flac", lyricOffsetMs: 0 }).includes("0"));
});
