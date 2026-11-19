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
