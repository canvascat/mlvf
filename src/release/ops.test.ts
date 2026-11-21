import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyQueue, type QueueFile, type QueueItem } from "./queue";
import {
  DEFAULT_TIMING, nextLocalMidnight, uploadById, type ReleaseRuntime,
} from "./ops";
import type { QueueStore } from "./store";

function memoryStore(items: QueueItem[]): QueueStore & { items: () => QueueItem[] } {
  let queue: QueueFile = { ...emptyQueue(), items: structuredClone(items) };
  return {
    load: () => structuredClone(queue),
    save: (next) => { queue = structuredClone(next); },
    patch: (id, update) => {
      const found = queue.items.find((entry) => entry.id === id);
      if (!found) return undefined;
      update(found);
      return structuredClone(found);
    },
    items: () => structuredClone(queue.items),
  };
}

const item = (patch: Partial<QueueItem> = {}): QueueItem => ({
  id: "release-abcd1234-01", mode: "first", status: "pending", video: "/out/a.mkv",
  title: "叹服", created: "2026-11-21T10:00:00+08:00",
  upload: { title: "叹服", desc: "d", tag: "t", cover: "/out/a.jpg", tid: 130, copyright: 1, dynamic: "", hires: 0 },
  ...patch,
});

const runtime = (
  store: QueueStore,
  run: ReleaseRuntime["run"],
  extra: Partial<ReleaseRuntime> = {},
): ReleaseRuntime => ({
  store, run, log: () => undefined, sleep: async () => undefined,
  timing: DEFAULT_TIMING, biliup: "biliup", ffmpeg: "ffmpeg", ...extra,
});

test("投稿成功后写回稿件号和完成时间，没有小节就不加合集", async () => {
  const store = memoryStore([item()]);
  const outcome = await uploadById(
    runtime(store, async () => ({ exitCode: 0, output: "Web 接口投稿成功 BV1abcdefghi" })),
    "release-abcd1234-01",
  );
  assert.equal(outcome, "uploaded");
  const saved = store.items()[0];
  assert.equal(saved?.status, "done");
  assert.equal(saved?.bvid, "BV1abcdefghi");
  assert.equal(saved?.season_added, false);
  assert.ok(saved?.finished);
});

test("覆盖稿遇到 137022：不存草稿、保持 pending，并通知写 hold_until", async () => {
  const store = memoryStore([item({ mode: "overwrite", bvid: "BV1zzzzzzzzzz" })]);
  let held: number | undefined;
  await assert.rejects(
    uploadById(
      runtime(
        store,
        async () => ({ exitCode: 1, output: "137022 投稿过于频繁" }),
        { onHold: (until) => { held = until; } },
      ),
      "release-abcd1234-01",
    ),
    /不存草稿/,
  );
  assert.equal(store.items()[0]?.status, "pending");
  assert.ok(held !== undefined && held > Date.now());
});

test("找不到待投稿条目时报错", async () => {
  await assert.rejects(
    uploadById(runtime(memoryStore([]), async () => ({ exitCode: 0, output: "" })), "nope"),
    /找不到待投稿/,
  );
});

test("次日 00:00 取本地时间", () => {
  const now = new Date(2026, 10, 21, 23, 30).getTime();
  assert.equal(nextLocalMidnight(now), new Date(2026, 10, 22, 0, 0).getTime());
});
