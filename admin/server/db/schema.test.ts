import assert from "node:assert/strict";
import { test } from "node:test";
import { openDb } from "./client";
import { albums, releases, runnerState, tracks } from "./schema";

const upload = { uploadTitle: "t", uploadDesc: "d", uploadTag: "g", uploadCover: "c.jpg" };
const base = { mode: "first", status: "pending", title: "t", createdAt: 1, ...upload } as const;

function seed() {
  const db = openDb(":memory:");
  const album = db.insert(albums).values({ prepareDir: "/p/a", title: "A", createdAt: 1 }).returning().get();
  const track = db.insert(tracks).values({ configPath: "/p/a/1.json", title: "T", createdAt: 1 }).returning().get();
  return { db, album, track };
}

test("releases 必须且只能属于一首歌或一张专辑", () => {
  const { db, album, track } = seed();
  db.insert(releases).values({ id: "a", video: "/a.mkv", trackId: track.id, ...base }).run();
  db.insert(releases).values({ id: "b", video: "/b.mkv", albumId: album.id, ...base }).run();
  assert.throws(() => db.insert(releases).values({ id: "c", video: "/c.mkv", ...base }).run());
  assert.throws(() => db.insert(releases).values({
    id: "d", video: "/d.mkv", trackId: track.id, albumId: album.id, ...base,
  }).run());
});

test("成片路径唯一", () => {
  const { db, track } = seed();
  db.insert(releases).values({ id: "a", video: "/a.mkv", trackId: track.id, ...base }).run();
  assert.throws(() => db.insert(releases).values({ id: "b", video: "/a.mkv", trackId: track.id, ...base }).run());
});

test("外键生效：不能指向不存在的曲目", () => {
  const { db } = seed();
  assert.throws(() => db.insert(releases).values({ id: "a", video: "/a.mkv", trackId: 999, ...base }).run());
});

test("runner_state 只有一行，迁移后已存在", () => {
  const db = openDb(":memory:");
  assert.equal(db.select().from(runnerState).all().length, 1);
  assert.throws(() => db.insert(runnerState).values({ id: 2 }).run());
});
