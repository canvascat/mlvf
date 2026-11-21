import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPublishBody } from "./publish-draft";

const view = {
  archive: {
    aid: 1, title: "t", desc: "d", tag: "a,b", cover: "https://x/c.jpg", tid: 130,
    copyright: 1, dynamic: "动态",
  },
  videos: [{ filename: "n123", title: "分P", desc: "", cid: 99, extra: "x" }],
};

test("只带发布需要的稿件字段，不带 aid，分 P 只保留四个字段", () => {
  const body = buildPublishBody(view, 1);
  assert.equal(body.title, "t");
  assert.equal(body.dynamic, "动态");
  assert.equal("aid" in body, false);
  assert.deepEqual(body.videos, [{ filename: "n123", title: "分P", desc: "", cid: 99 }]);
  assert.equal(body.lossless_music, 1);
  assert.equal(body.dolby, 0);
});

test("字段直接在顶层时也能读", () => {
  const body = buildPublishBody({ title: "t", tid: 130, videos: view.videos }, 0);
  assert.equal(body.title, "t");
  assert.equal(body.lossless_music, 0);
});

test("草稿里没有视频时拒绝发布", () => {
  assert.throws(() => buildPublishBody({ archive: view.archive, videos: [] }, 0), /没有视频/);
});
