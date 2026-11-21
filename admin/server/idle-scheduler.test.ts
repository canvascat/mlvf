import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { openDb, type Db } from "./db/client";
import { jobs, releases, runnerState, tracks } from "./db/schema";
import { claimNext, finishJob } from "./jobs";
import { createIdleHook, enqueueIdleJobs } from "./idle-scheduler";
import { getSettings } from "./settings";

function seedRelease(db: Db, id: string, createdAt: number, patch: Partial<typeof releases.$inferInsert> = {}) {
  const track = db.insert(tracks).values({
    trackNo: 1, prepareDir: `/p/${id}`, configPath: `/p/${id}/a.json`, title: id, createdAt: 1,
  }).returning().get();
  db.insert(releases).values({
    id, trackId: track.id, mode: "first", status: "pending", video: `/out/${id}.mkv`, title: id,
    uploadTitle: id, uploadDesc: "d", uploadTag: "t", uploadCover: `/out/${id}.jpg`, createdAt,
    ...patch,
  }).run();
}

const at = (hour: number, day = 21) => new Date(2026, 10, day, hour, 0).getTime();

test("先发布草稿，再传 pending；草稿箱里数据库没记下的排在已记下的后面", async () => {
  const db = openDb(":memory:");
  seedRelease(db, "p1", 10);
  seedRelease(db, "d1", 20, { status: "draft", draftId: "11" });
  const created = await enqueueIdleJobs(db, 100, async () => ["11", "99"]);
  assert.deepEqual(
    created.map((job) => [job.kind, job.payload.draftId ?? job.payload.releaseId]),
    [["publish_draft", "11"], ["publish_draft", "99"], ["upload", "p1"]],
  );
  assert.deepEqual(created[1]?.dependsOn, [created[0]?.id]);
  assert.deepEqual(created[2]?.dependsOn, [created[1]?.id]);
});

test("覆盖稿没有稿件号时不排", async () => {
  const db = openDb(":memory:");
  seedRelease(db, "o1", 10, { mode: "overwrite" });
  assert.deepEqual(await enqueueIdleJobs(db, 100, async () => []), []);
});

test("bili 上还有没结束的任务时不排", async () => {
  const db = openDb(":memory:");
  seedRelease(db, "p1", 10);
  assert.equal((await enqueueIdleJobs(db, 100, async () => [])).length, 1);
  assert.equal((await enqueueIdleJobs(db, 101, async () => [])).length, 0);
});

test("夜间窗口里排队；失败后同一个空闲窗口不再重排；离开窗口再回来才重排", async () => {
  const db = openDb(":memory:");
  seedRelease(db, "p1", 10);
  let now = at(2);
  const hook = createIdleHook(db, {
    now: () => now,
    screenLocked: async () => false,
    listDraftIds: async () => [],
  });
  await hook(getSettings(db));
  const first = db.select().from(jobs).all();
  assert.equal(first.length, 1);
  claimNext(db, "bili", now);
  finishJob(db, first[0]!.id, { status: "failed", error: "投稿过于频繁" }, now);

  now = at(2) + 120_000;
  await hook(getSettings(db));
  assert.equal(db.select().from(jobs).all().length, 1);

  now = at(12);
  await hook(getSettings(db));
  now = at(2, 22);
  await hook(getSettings(db));
  assert.equal(db.select().from(jobs).all().length, 2);
});

test("白天不锁屏不排队；刚发现锁屏只记 locked_since；满 10 分钟才排", async () => {
  const db = openDb(":memory:");
  seedRelease(db, "p1", 10);
  let now = at(14);
  let locked = false;
  const hook = createIdleHook(db, {
    now: () => now, screenLocked: async () => locked, listDraftIds: async () => [],
  });
  await hook(getSettings(db));
  assert.equal(db.select().from(jobs).all().length, 0);

  locked = true;
  now += 60_000;
  await hook(getSettings(db));
  assert.equal(db.select().from(jobs).all().length, 0);
  assert.equal(db.select().from(runnerState).get()?.lockedSince, now);

  now += 10 * 60_000;
  await hook(getSettings(db));
  assert.equal(db.select().from(jobs).all().length, 1);

  locked = false;
  now += 60_000;
  await hook(getSettings(db));
  assert.equal(db.select().from(runnerState).where(eq(runnerState.id, 1)).get()?.lockedSince, null);
});

test("hold_until 没到时不排", async () => {
  const db = openDb(":memory:");
  seedRelease(db, "p1", 10);
  db.update(runnerState).set({ holdUntil: at(2) + 3_600_000 }).where(eq(runnerState.id, 1)).run();
  const hook = createIdleHook(db, {
    now: () => at(2), screenLocked: async () => false, listDraftIds: async () => [],
  });
  await hook(getSettings(db));
  assert.equal(db.select().from(jobs).all().length, 0);
});
