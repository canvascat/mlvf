import assert from "node:assert/strict";
import { test } from "node:test";
import { exportAndEnqueue } from "./export-batch";
import { emptyQueue } from "./queue";

test("已有成片跳过渲染，失败则停住后面的歌", async () => {
  const calls: string[] = [];
  const queue = emptyQueue();
  const tracks = [1, 2].map((index) => ({
    index, configPath: `${index}.json`, songName: `歌${index}`, artistName: "许嵩",
    albumName: "寻雾启示", audioPath: `${index}.flac`, textPath: `${index}.txt`,
  }));
  await assert.rejects(() => exportAndEnqueue({
    tracks, outDir: "/out", prepareDir: "/prep", overwriteVideo: false,
    exportVideo: async (_config, out) => { calls.push(out); if (out.includes("歌2")) throw new Error("渲染失败"); },
    fileExists: (file) => file.endsWith("歌1.mkv"),
    probe: async () => ({ lossless: true, sampleRate: 44100, bitsPerSample: 16 }),
    readText: (file) => `标题\n许嵩《${file}》\n\n简介\n正文\n`,
    loadQueue: () => queue,
    saveQueue: (next) => { queue.items = next.items; },
    onEnqueued: () => undefined,
  }));
  assert.deepEqual(calls, ["/out/许嵩-歌2.mkv"]);
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0]?.upload.hires, 0);
  assert.match(queue.items[0]?.upload.dynamic ?? "", /整张专辑/);
});
