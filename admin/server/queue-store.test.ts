import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import type { QueueFile, QueueItem } from "../../src/release/queue";
import { openDb } from "./db/client";
import { releases, tracks } from "./db/schema";
import { createDbQueueStore, importQueueJson } from "./queue-store";

const item = (id: string, patch: Partial<QueueItem> = {}): QueueItem => ({
  id, mode: "first", status: "pending", video: `/out/${id}.mkv`, title: id,
  created: "2026-11-19T10:00:00+08:00",
  upload: { title: id, desc: "d", tag: "t", cover: `/out/${id}.jpg`, tid: 130, copyright: 1, dynamic: "", hires: 0 },
  ...patch,
});

test("保存再读取，条目内容不变", () => {
  const store = createDbQueueStore(openDb(":memory:"));
  const queue = store.load();
  queue.items.push(item("a", { bvid: "BV1xx", season_id: 1, section_id: 2, season_added: false }));
  store.save(queue);
  assert.deepEqual(store.load().items, [item("a", { bvid: "BV1xx", season_id: 1, section_id: 2, season_added: false })]);
});

test("只写有变化的条目：过期快照不会覆盖别处的更新", () => {
  const db = openDb(":memory:");
  const store = createDbQueueStore(db);
  const first = store.load();
  first.items.push(item("a"), item("b"));
  store.save(first);
  const stale = store.load();
  store.patch("a", (current) => { current.status = "done"; current.bvid = "BV1aa"; });
  stale.items[1]!.title = "b2";
  store.save(stale);
  const after = store.load().items;
  assert.equal(after.find((x) => x.id === "a")?.status, "done");
  assert.equal(after.find((x) => x.id === "b")?.title, "b2");
});

test("save 收到展开出来的新对象时，也只写和库里不同的条目", () => {
  const db = openDb(":memory:");
  const store = createDbQueueStore(db);
  const first = store.load();
  first.items.push(item("a"), item("b"));
  store.save(first);
  store.patch("a", (current) => { current.status = "done"; });
  const loaded = store.load();
  const spread = { ...loaded, items: [...loaded.items, item("c")] };
  store.patch("b", (current) => { current.title = "b2"; });
  store.save(spread);
  const after = store.load().items;
  assert.equal(after.find((x) => x.id === "a")?.status, "done");
  assert.equal(after.find((x) => x.id === "b")?.title, "b2");
  assert.ok(after.find((x) => x.id === "c"));
});

test("patch 找不到返回 undefined", () => {
  assert.equal(createDbQueueStore(openDb(":memory:")).patch("nope", () => {}), undefined);
});

test("新条目没有对应曲目时建占位曲目，且满足归属约束", () => {
  const db = openDb(":memory:");
  const store = createDbQueueStore(db);
  const queue = store.load();
  queue.items.push(item("zard-BV1"));
  store.save(queue);
  const row = db.select().from(releases).where(eq(releases.id, "zard-BV1")).get();
  assert.ok(row?.trackId);
  assert.equal(db.select().from(tracks).get()?.configPath, "legacy:/out/zard-BV1.mkv");
});

test("导入旧 JSON：幂等、保留旧字段、改名原文件", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "queue-import-"));
  const file = path.join(dir, "upload-queue.json");
  const legacy = { ...item("old-1", { status: "done", bvid: "BV1ab", finished: "2026-10-26T14:04:26" }),
    config: "/prep/A/01.json", song: "歌", artist: "手", album: "辑", lyrics: "/prep/A/01.ttml", lyric_offset_ms: 120 };
  const data: QueueFile = { locked_since: null, hold_until: "2026-11-19T01:00:00+08:00",
    items: [legacy as QueueItem, item("old-2")] };
  writeFileSync(file, JSON.stringify(data));
  const db = openDb(":memory:");
  assert.deepEqual(importQueueJson(db, file), { imported: 2, skipped: 0 });
  assert.equal(existsSync(file), false);
  assert.equal(existsSync(`${file}.imported`), true);
  const real = db.select().from(tracks).where(eq(tracks.configPath, "/prep/A/01.json")).get();
  assert.equal(real?.title, "歌");
  assert.equal(real?.lyricOffsetMs, 120);
  const store = createDbQueueStore(db);
  assert.equal(store.load().hold_until, "2026-11-19T01:00:00+08:00");
  writeFileSync(file, JSON.stringify(data));
  assert.deepEqual(importQueueJson(db, file), { imported: 0, skipped: 2 });
});

test("导入失败整体回滚，原文件不动", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "queue-import-"));
  const file = path.join(dir, "upload-queue.json");
  const bad = { locked_since: null, hold_until: null, items: [item("ok"), { ...item("bad"), created: "不是时间" }] };
  writeFileSync(file, JSON.stringify(bad));
  const db = openDb(":memory:");
  assert.throws(() => importQueueJson(db, file), /无法解析时间/);
  assert.equal(existsSync(file), true);
  assert.equal(db.select().from(releases).all().length, 0);
});
