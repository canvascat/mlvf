import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { listReleaseTracks } from "./order";

test("有音轨号时按音轨号排，没有则按文件名", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "release-order-"));
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "乙.json"), JSON.stringify({
    songName: "乙", artistName: "许嵩", albumName: "寻雾启示", audioFileUrl: "乙.flac",
  }));
  await writeFile(path.join(dir, "甲.json"), JSON.stringify({
    songName: "甲", artistName: "许嵩", albumName: "寻雾启示", audioFileUrl: "甲.flac",
  }));
  const tracks = await listReleaseTracks(dir, async (audio) =>
    audio.endsWith("甲.flac") ? 2 : null);
  assert.deepEqual(tracks.map((track) => track.songName), ["甲", "乙"]);
  assert.equal(tracks[0]?.index, 1);
  assert.equal(tracks[1]?.lyricPath, undefined);
});
