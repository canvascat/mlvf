import assert from "node:assert/strict";
import { test } from "node:test";
import { uploadItem } from "./upload-one";

test("21566 等待后重试同一首，再频繁则存草稿", async () => {
  const sleeps: number[] = [];
  const commands: string[][] = [];
  let n = 0;
  const item = {
    id: "release-abcd1234-01", mode: "first" as const, status: "pending" as const,
    video: "/out/a.mkv", title: "许嵩《叹服》", created: "t",
    upload: { title: "许嵩《叹服》", desc: "简介", tag: "许嵩,寻雾启示,歌词视频,叹服", cover: "/out/a.jpg", tid: 130, copyright: 1, dynamic: "许嵩《寻雾启示》整张专辑", hires: 0 as const },
  };
  const result = await uploadItem(item, {
    cookie: "/cookies.json",
    run: async (command) => {
      commands.push(command);
      n += 1;
      return n === 1
        ? { exitCode: 1, output: "21566 投稿过于频繁" }
        : { exitCode: 1, output: "137022 投稿过于频繁" };
    },
    sleep: async (ms) => { sleeps.push(ms); },
    saveDraft: async () => "draft-1",
  });
  assert.equal(result.status, "draft");
  assert.equal(commands.length, 2);
  assert.deepEqual(sleeps, [180_000]);
  assert.equal(commands[0]?.includes("--submit"), true);
  assert.equal(commands[0]?.includes("web"), true);
});

test("可指定 biliup 可执行文件和 21566 的等待时长", async () => {
  const sleeps: number[] = [];
  const commands: string[][] = [];
  let n = 0;
  const item = {
    id: "release-abcd1234-01", mode: "first" as const, status: "pending" as const,
    video: "/out/a.mkv", title: "t", created: "c",
    upload: { title: "t", desc: "d", tag: "x", cover: "/out/a.jpg", tid: 130, copyright: 1, dynamic: "", hires: 0 as const },
  };
  const result = await uploadItem(item, {
    cookie: "/cookies.json",
    bin: "/opt/bin/biliup",
    retryWaitMs: 5000,
    run: async (command) => {
      commands.push(command);
      n += 1;
      return n === 1
        ? { exitCode: 1, output: "21566 投稿过于频繁" }
        : { exitCode: 0, output: "Web 接口投稿成功 BV1abcdefghi" };
    },
    sleep: async (ms) => { sleeps.push(ms); },
    saveDraft: async () => "never",
  });
  assert.deepEqual(result, { status: "done", bvid: "BV1abcdefghi" });
  assert.deepEqual(sleeps, [5000]);
  assert.equal(commands[0]?.[0], "/opt/bin/biliup");
});
