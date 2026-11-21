import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { openDb, type Db } from "./db/client";
import { albums, releases, tracks } from "./db/schema";
import { finishJob } from "./jobs";
import { planExport, planUpload } from "./orchestrate";

function seedAlbum(db: Db, count: number) {
  const album = db.insert(albums).values({
    prepareDir: "/p/寻雾", title: "寻雾启示", artist: "许嵩", trackCount: count, createdAt: 1,
  }).returning().get();
  const rows = Array.from({ length: count }, (_, i) => db.insert(tracks).values({
    albumId: album.id, trackNo: i + 1, prepareDir: "/p/寻雾", configPath: `/p/寻雾/${i + 1}.json`,
    title: `歌${i + 1}`, artist: "许嵩", albumTitle: "寻雾启示", createdAt: 1,
  }).returning().get());
  return { album, rows };
}

const kinds = (rows: { kind: string }[]) => rows.map((row) => row.kind);

test("只导出：每首 export → cover，不建合集", () => {
  const db = openDb(":memory:");
  const { album } = seedAlbum(db, 2);
  const created = planExport(db, { mode: "export", albumId: album.id });
  assert.deepEqual(kinds(created), ["export", "cover", "export", "cover"]);
  assert.deepEqual(created[1]?.dependsOn, [created[0]?.id]);
  assert.match(String(created[0]?.payload.outPath), /out\/寻雾\/许嵩-歌1\.mkv$/);
});

test("导出并上传：先建合集，cover 依赖合集，上传串成链", () => {
  const db = openDb(":memory:");
  const { album } = seedAlbum(db, 2);
  const created = planExport(db, { mode: "export-and-upload", albumId: album.id });
  assert.deepEqual(kinds(created), ["season", "export", "cover", "export", "cover", "upload", "upload"]);
  const [season, , cover1, , cover2, up1, up2] = created;
  assert.deepEqual(cover1?.dependsOn.sort(), [created[1]?.id, season?.id].sort());
  assert.deepEqual(up1?.dependsOn, [cover1?.id]);
  assert.deepEqual(up2?.dependsOn.sort(), [cover2?.id, up1?.id].sort());
  assert.equal(up1?.payload.releaseId, up1?.releaseId);
  assert.match(String(up1?.releaseId), /^release-[0-9a-f]{8}-01$/);
});

test("导出后上传：每个上传都等全部 cover", () => {
  const db = openDb(":memory:");
  const { album } = seedAlbum(db, 2);
  const created = planExport(db, { mode: "export-then-upload", albumId: album.id });
  const covers = created.filter((row) => row.kind === "cover").map((row) => row.id);
  const uploads = created.filter((row) => row.kind === "upload");
  for (const upload of uploads) {
    for (const id of covers) assert.ok(upload.dependsOn.includes(id));
  }
});

test("单曲没有专辑：不排 season", () => {
  const db = openDb(":memory:");
  const track = db.insert(tracks).values({
    trackNo: 1, prepareDir: "/p/单曲", configPath: "/p/单曲/a.json",
    title: "歌", artist: "手", createdAt: 1,
  }).returning().get();
  const created = planExport(db, { mode: "export-and-upload", trackIds: [track.id] });
  assert.deepEqual(kinds(created), ["export", "cover", "upload"]);
});

test("专辑已有合集小节时不再排 season", () => {
  const db = openDb(":memory:");
  const { album } = seedAlbum(db, 1);
  db.update(albums).set({ seasonId: 9, sectionId: 10 }).where(eq(albums.id, album.id)).run();
  const created = planExport(db, { mode: "export-and-upload", albumId: album.id });
  assert.deepEqual(kinds(created), ["export", "cover", "upload"]);
});

test("旧队列导入的占位曲目不能导出", () => {
  const db = openDb(":memory:");
  const track = db.insert(tracks).values({
    prepareDir: "", configPath: "legacy:/out/a.mkv", title: "a", createdAt: 1,
  }).returning().get();
  assert.throws(() => planExport(db, { mode: "export", trackIds: [track.id] }), /占位/);
});

function seedRelease(db: Db, id: string, patch: Partial<typeof releases.$inferInsert> = {}) {
  const track = db.insert(tracks).values({
    trackNo: 1, prepareDir: `/p/${id}`, configPath: `/p/${id}/a.json`, title: id, createdAt: 1,
  }).returning().get();
  return db.insert(releases).values({
    id, trackId: track.id, mode: "first", status: "pending", video: `/out/${id}.mkv`, title: id,
    uploadTitle: id, uploadDesc: "d", uploadTag: "t", uploadCover: `/out/${id}.jpg`, createdAt: 1,
    ...patch,
  }).returning().get();
}

test("planUpload：pending 排 upload，draft 排 publish_draft，串成链", () => {
  const db = openDb(":memory:");
  seedRelease(db, "r1");
  seedRelease(db, "r2", { status: "draft", draftId: "77" });
  const created = planUpload(db, { releaseIds: ["r2", "r1"] });
  assert.deepEqual(kinds(created), ["publish_draft", "upload"]);
  assert.equal(created[0]?.payload.draftId, "77");
  assert.deepEqual(created[1]?.dependsOn, [created[0]?.id]);
});

test("planUpload：重复入队、覆盖缺稿件号、已完成都拒绝", () => {
  const db = openDb(":memory:");
  seedRelease(db, "r1");
  seedRelease(db, "r2", { mode: "overwrite" });
  seedRelease(db, "r3", { status: "done", bvid: "BV1aaaaaaaaaa" });
  const first = planUpload(db, { releaseIds: ["r1"] });
  assert.throws(() => planUpload(db, { releaseIds: ["r1"] }), /已在队列/);
  finishJob(db, first[0]!.id, { status: "failed", error: "x" }, 5);
  assert.equal(planUpload(db, { releaseIds: ["r1"] }).length, 1);
  assert.throws(() => planUpload(db, { releaseIds: ["r2"] }), /稿件号/);
  assert.throws(() => planUpload(db, { releaseIds: ["r3"] }), /已投稿/);
});
