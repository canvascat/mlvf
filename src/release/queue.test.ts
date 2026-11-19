import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyQueue, pendingOf, releaseItemId, upsertPending } from "./queue";

test("同一成片的 pending 被更新，done 不重置", () => {
  const id = releaseItemId("/album", 1);
  const first = {
    id, mode: "overwrite" as const, status: "pending" as const, bvid: "BV1",
    video: "/out/a.mkv", title: "旧", created: "t",
    upload: { title: "旧", desc: "", tag: "", cover: "", tid: 130, copyright: 1, dynamic: "", hires: 0 as const },
  };
  const next = { ...first, mode: "first" as const, title: "新", bvid: undefined };
  const updated = upsertPending(emptyQueue(), first);
  const again = upsertPending(updated, next);
  assert.equal(again.items.length, 1);
  assert.equal(again.items[0]?.title, "新");
  assert.equal(again.items[0]?.mode, "overwrite");
  assert.equal(again.items[0]?.bvid, "BV1");
  const done = upsertPending({ ...again, items: [{ ...again.items[0]!, status: "done" }] }, next);
  assert.equal(done.items[0]?.status, "done");
  assert.deepEqual(pendingOf(again, [id, "other"]).map((item) => item.id), [id]);
  const uploaded = new Set(["/out/a.mkv"]);
  assert.deepEqual(pendingOf(again, [id], uploaded).map((item) => item.id), []);
});
