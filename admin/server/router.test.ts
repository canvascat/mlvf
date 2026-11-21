import assert from "node:assert/strict";
import { test } from "node:test";
import { openDb, type Db } from "./db/client";
import { albums, releases, tracks } from "./db/schema";
import { createCaller } from "./router";

const caller = (db: Db) => createCaller({ db });

function seedAlbum(db: Db) {
  const album = db.insert(albums).values({
    prepareDir: "/p/寻雾", title: "寻雾启示", artist: "许嵩", trackCount: 1, createdAt: 1,
  }).returning().get();
  const track = db.insert(tracks).values({
    albumId: album.id, trackNo: 1, prepareDir: "/p/寻雾", configPath: "/p/寻雾/1.json",
    title: "歌1", artist: "许嵩", albumTitle: "寻雾启示", createdAt: 1,
  }).returning().get();
  return { album, track };
}

function seedRelease(db: Db, trackId: number, patch: Partial<typeof releases.$inferInsert> = {}) {
  return db.insert(releases).values({
    id: "r1", trackId, mode: "first", status: "pending", video: "/out/r1.mkv", title: "r1",
    uploadTitle: "r1", uploadDesc: "d", uploadTag: "t", uploadCover: "/out/r1.jpg", createdAt: 1,
    ...patch,
  }).returning().get();
}

test("设置：读默认值，改并行数后出现警告，非法值被拒绝", async () => {
  const api = caller(openDb(":memory:"));
  const before = await api.settings.get();
  assert.equal(before.values["bili.maxParallel"], 1);
  assert.equal(before.warnings.length, 0);
  const after = await api.settings.update({ "bili.maxParallel": 2 });
  assert.ok(after.warnings.some((warning) => warning.key === "bili.maxParallel"));
  await assert.rejects(api.settings.update({ "bili.maxParallel": 99 }), /bili.maxParallel/);
  await assert.rejects(api.settings.update({ nope: 1 }), /未知配置项/);
});

test("入队导出，取消排队中的任务会级联取消下游，重试后下游复活", async () => {
  const db = openDb(":memory:");
  const { album } = seedAlbum(db);
  const api = caller(db);
  const created = await api.jobs.enqueueExport({ mode: "export", albumId: album.id });
  assert.deepEqual(created.map((job) => job.kind), ["export", "cover"]);
  const exportJob = created[0]!;
  assert.equal((await api.jobs.cancel({ id: exportJob.id })).result, "cancelled");
  const afterCancel = await api.jobs.list({});
  assert.deepEqual(afterCancel.rows.map((row) => row.status).sort(), ["cancelled", "cancelled"]);
  const retried = await api.jobs.retry({ id: exportJob.id });
  const afterRetry = await api.jobs.list({});
  assert.equal(afterRetry.rows.find((row) => row.id === created[1]!.id)?.status, "queued");
  assert.equal(retried.retryOf, exportJob.id);
});

test("任务列表带上曲目和专辑名，可按状态过滤", async () => {
  const db = openDb(":memory:");
  const { album } = seedAlbum(db);
  const api = caller(db);
  await api.jobs.enqueueExport({ mode: "export", albumId: album.id });
  const queued = await api.jobs.list({ status: ["queued"] });
  assert.equal(queued.rows.length, 2);
  assert.equal(queued.rows[0]?.trackTitle, "歌1");
  assert.equal(queued.rows[0]?.albumTitle, "寻雾启示");
  assert.equal((await api.jobs.list({ status: ["failed"] })).rows.length, 0);
});

test("登记目录必须在 预处理/ 下", async () => {
  const api = caller(openDb(":memory:"));
  await assert.rejects(api.library.register({ dir: "/etc" }), /不在允许范围/);
});

test("备料入队：音频文件必须存在", async () => {
  const api = caller(openDb(":memory:"));
  await assert.rejects(api.jobs.enqueuePrepare({ audio: "/nonexistent/a.flac" }), /不存在/);
  await assert.rejects(api.jobs.enqueuePrepare({ audio: "relative/a.flac" }), /绝对路径/);
});

test("编辑上传信息：只有 pending 且没有进行中任务的可以改", async () => {
  const db = openDb(":memory:");
  const { track } = seedAlbum(db);
  seedRelease(db, track.id);
  const api = caller(db);
  const updated = await api.releases.updateUpload({ id: "r1", title: "新标题", tid: 3 });
  assert.equal(updated?.uploadTitle, "新标题");
  assert.equal(updated?.uploadTid, 3);
  await api.releases.enqueueUpload({ ids: ["r1"] });
  await assert.rejects(api.releases.updateUpload({ id: "r1", title: "再改" }), /进行中/);
  db.update(releases).set({ status: "done" }).run();
  await assert.rejects(api.releases.updateUpload({ id: "r1", title: "再改" }), /pending/);
});

test("删除成片：只能删 pending", async () => {
  const db = openDb(":memory:");
  const { track } = seedAlbum(db);
  seedRelease(db, track.id, { status: "done", bvid: "BV1aaaaaaaaaa" });
  const api = caller(db);
  await assert.rejects(api.releases.remove({ id: "r1" }), /pending/);
});

test("总览：runner 没起时离线，计数和警告齐全", async () => {
  const db = openDb(":memory:");
  const { album } = seedAlbum(db);
  const api = caller(db);
  await api.jobs.enqueueExport({ mode: "export", albumId: album.id });
  const overview = await api.overview.get();
  assert.equal(overview.runner.online, false);
  assert.equal(overview.jobCounts.queued, 2);
  assert.deepEqual(overview.warnings, []);
});

test("历史：统计按天汇总", async () => {
  const api = caller(openDb(":memory:"));
  const stats = await api.history.stats();
  assert.deepEqual(stats.days, []);
  assert.equal(stats.avgRenderSec, null);
});
