import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openDb } from "./db/client";
import { albums, tracks } from "./db/schema";
import { registerPrepareDir, type RegisterDeps } from "./library";

const deps: RegisterDeps = {
  readTrackNumber: async (audio) => (audio.endsWith("乙.flac") ? 1 : audio.endsWith("甲.flac") ? 2 : null),
  probe: async () => ({ lossless: true, sampleRate: 96000, bitsPerSample: 24, durationSec: 200 }),
};

function prepare(names: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), "library-"));
  for (const name of names) {
    writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({
      songName: name, artistName: "许嵩", albumName: "寻雾启示",
      audioFileUrl: `${name}.flac`, lyricsFileUrl: `${name}.yrc`, coverImageUrl: "cover.jpg",
      year: 2026, genre: "Pop", match: { lyricSource: "netease", lyricFormat: "yrc" },
    }));
  }
  return dir;
}

test("多首登记为专辑：按音轨号排曲序，曲目带音频规格和歌词来源", async () => {
  const db = openDb(":memory:");
  const result = await registerPrepareDir(db, prepare(["甲", "乙"]), deps, 1);
  assert.equal(result.album?.title, "寻雾启示");
  assert.equal(result.album?.trackCount, 2);
  assert.deepEqual(result.tracks.map((t) => [t.title, t.trackNo, t.albumId === result.album?.id]),
    [["乙", 1, true], ["甲", 2, true]]);
  const first = result.tracks[0];
  assert.equal(first?.audioSampleRate, 96000);
  assert.equal(first?.audioLossless, true);
  assert.equal(first?.lyricSource, "netease");
  assert.equal(first?.lyricFormat, "yrc");
  assert.equal(first?.durationSec, 200);
});

test("只有一首登记为单曲：不建专辑，album_id 为空", async () => {
  const db = openDb(":memory:");
  const result = await registerPrepareDir(db, prepare(["丙"]), deps, 1);
  assert.equal(result.album, null);
  assert.equal(result.tracks[0]?.albumId, null);
  assert.equal(db.select().from(albums).all().length, 0);
});

test("重复登记不新增行，只更新", async () => {
  const db = openDb(":memory:");
  const dir = prepare(["甲", "乙"]);
  await registerPrepareDir(db, dir, deps, 1);
  await registerPrepareDir(db, dir, deps, 2);
  assert.equal(db.select().from(albums).all().length, 1);
  assert.equal(db.select().from(tracks).all().length, 2);
});

test("目录里没有 json 时报错", async () => {
  await assert.rejects(registerPrepareDir(openDb(":memory:"), prepare([]), deps), /没有曲目/);
});
