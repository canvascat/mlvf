# Release CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 `nub run release` 固定单首导出、单首投稿、建合集，以及「导出后上传」「导出并上传」。

**Architecture:** 曲序、队列更新、Hi-Res、投稿结果分类和投稿调度都是纯函数，用 `node:test` 测。`cli.ts` 把这些函数接到现有 `exportVideo`、`biliup` 和合集 HTTP。调度只决定「现在传哪一首、还是再等多久」，不自己渲染。

**Tech Stack:** TypeScript、`node:test`、`node --import ./scripts/register-ts.mjs --test`、现有 `exportVideo`、`biliup`。

## Global Constraints

- 导出始终 1 路，不改 `--gl=angle`，不传系统 Chrome 以外的现有渲染参数。
- 投稿必须 `biliup upload --submit web`，登录态 `~/.config/biliup/cookies.json`。
- 成功投稿之间至少隔 180 秒。同一时间只有一首在传。
- `21566` 等 180 秒后重试同一首。`137022`，或已经隔过 180 秒仍是投稿过于频繁，从这一条起存草稿并停止投稿。
- 两种批量只处理本批 `id`。不改 `hold_until`，不传其他专辑。
- 命令在当前终端前台跑，计划里的实现命令也不用 `nohup`。
- 提交说明用 `:<gitmoji>: <type>(release): <简体中文>`。

## File Structure

- Create: `src/release/order.ts` — 按音轨号或文件名排备料 json
- Create: `src/release/queue.ts` — 队列读写、本批 id、更新 pending
- Create: `src/release/media.ts` — Hi-Res、动态文案、封面秒数选择
- Create: `src/release/upload-result.ts` — 从 biliup 输出判断成功、重试或存草稿
- Create: `src/release/schedule.ts` — 两种批量的下一步动作
- Create: `src/release/export-batch.ts` — 串行调用 `exportVideo`，跳过已有成片
- Create: `src/release/upload-one.ts` — 组装 biliup 参数并按分类重试
- Create: `src/release/season.ts` — 创建或复用合集，加入小节
- Create: `src/release/cli.ts` — 子命令
- Modify: `package.json` — `"release": "nub src/release/cli.ts"`
- Modify: `.agents/skills/single-track-batch/SKILL.md` — 导出和入队改走 `release`
- Test: 与上述纯模块同目录的 `*.test.ts`

---

### Task 1: 曲序

**Files:**
- Create: `src/release/order.ts`
- Test: `src/release/order.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `listReleaseTracks(dir: string, readTrack: (audioPath: string) => Promise<number | null>): Promise<ReleaseTrack[]>`

`ReleaseTrack` 为 `{ index: number; configPath: string; songName: string; artistName: string; albumName: string; audioPath: string; lyricPath?: string; textPath: string }`。`index` 从 1 起，是排序后的位置。

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { listReleaseTracks } from "./order";

test("有音轨号时按音轨号排，没有则按文件名", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "release-order-"));
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "乙.json"), JSON.stringify({
    songName: "乙", artistName: "许嵩", albumName: "寻雾启示", audioFileUrl: "乙.flac",
  }));
  await writeFile(path.join(dir, "甲.json"), JSON.stringify({
    songName: "甲", artistName: "许嵩", albumName: "寻雾启示", audioFileUrl: "甲.flac",
  }));
  const tracks = await listReleaseTracks(dir, async (audio) =>
    audio.endsWith("甲.flac") ? 2 : null);
  assert.deepEqual(tracks.map((track) => track.songName), ["乙", "甲"]);
  assert.equal(tracks[0]?.index, 1);
  assert.equal(tracks[1]?.lyricPath, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./scripts/register-ts.mjs --test src/release/order.test.ts`  
Expected: FAIL，找不到 `./order`

- [ ] **Step 3: Write minimal implementation**

`listReleaseTracks` 只读目录下的 `*.json`。`audioPath` 是 json 所在目录加上 `audioFileUrl`。有 `lyricsFileUrl` 时同样拼出 `lyricPath`。`textPath` 是 json 换成 `.txt`。`readTrack` 返回数字的排前面，按数字升序；返回 `null` 的排在有数字的后面，彼此按 `path.basename` 的 `zh-Hans` 排序。排序后再写 `index`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./scripts/register-ts.mjs --test src/release/order.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/release/order.ts src/release/order.test.ts
git commit -m "$(cat <<'EOF'
:sparkles: feat(release): 按音轨号排列备料曲目

EOF
)"
```

---

### Task 2: 队列只更新本批

**Files:**
- Create: `src/release/queue.ts`
- Test: `src/release/queue.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `batchKey(prepareDir: string): string` 目录名的 8 位 sha256
  - `releaseItemId(prepareDir: string, index: number): string` 形如 `release-<batchKey>-01`
  - `emptyQueue(): QueueFile`
  - `upsertPending(queue: QueueFile, item: QueueItem): QueueFile`
  - `pendingOf(queue: QueueFile, ids: string[]): QueueItem[]`

`QueueFile` 是 `{ locked_since: string | null; hold_until: string | null; items: QueueItem[] }`。`upsertPending` 用 `video` 找已有条目：`pending` 则替换字段，但保留原 `mode` 和 `bvid`；`done` 或 `draft` 则原样返回。找不到才追加。`pendingOf` 只返回 id 在列表里、状态为 `pending` 的条目，顺序跟 `ids` 一致。

- [ ] **Step 1: Write the failing test**

```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./scripts/register-ts.mjs --test src/release/queue.test.ts`  
Expected: FAIL，找不到 `./queue`

- [ ] **Step 3: Write minimal implementation**

`batchKey` 用 `node:crypto` 的 `createHash("sha256")` 对 `path.basename(prepareDir)` 取 hex 前 8 位。`releaseItemId` 把 `index` 用 `padStart(2, "0")`。`emptyQueue` 三个字段为 `null`、`null`、`[]`。不在这个模块里写磁盘。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./scripts/register-ts.mjs --test src/release/queue.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/release/queue.ts src/release/queue.test.ts
git commit -m "$(cat <<'EOF'
:sparkles: feat(release): 按成片路径更新本批投稿队列

EOF
)"
```

---

### Task 3: Hi-Res 与动态

**Files:**
- Create: `src/release/media.ts`
- Test: `src/release/media.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `hiresFor(input: { lossless: boolean; sampleRate: number; bitsPerSample: number }): 0 | 1`
  - `albumDynamic(artist: string, album: string): string`
  - `dynamicForTrack(index: number, artist: string, album: string, already: boolean): string`

`already` 为真时一律返回 `""`。只有 `index === 1` 且 `already` 为假时返回 `albumDynamic`。

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { albumDynamic, dynamicForTrack, hiresFor } from "./media";

test("44.1/16 不开 Hi-Res，96k 无损才开", () => {
  assert.equal(hiresFor({ lossless: true, sampleRate: 44100, bitsPerSample: 16 }), 0);
  assert.equal(hiresFor({ lossless: true, sampleRate: 96000, bitsPerSample: 24 }), 1);
  assert.equal(hiresFor({ lossless: false, sampleRate: 96000, bitsPerSample: 24 }), 0);
});

test("动态只给第一首，本批已有动态则不再写", () => {
  assert.equal(dynamicForTrack(1, "许嵩", "寻雾启示", false), albumDynamic("许嵩", "寻雾启示"));
  assert.equal(dynamicForTrack(2, "许嵩", "寻雾启示", false), "");
  assert.equal(dynamicForTrack(1, "许嵩", "寻雾启示", true), "");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./scripts/register-ts.mjs --test src/release/media.test.ts`  
Expected: FAIL，找不到 `./media`

- [ ] **Step 3: Write minimal implementation**

`hiresFor`：`lossless` 且（`sampleRate >= 96000` 或（`sampleRate >= 48000` 且 `bitsPerSample >= 24`））时返回 1，否则 0。`albumDynamic` 返回 `` `${artist}《${album}》整张专辑` ``。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./scripts/register-ts.mjs --test src/release/media.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/release/media.ts src/release/media.test.ts
git commit -m "$(cat <<'EOF'
:sparkles: feat(release): 按音轨规格决定 Hi-Res 和专辑动态

EOF
)"
```

---

### Task 4: 投稿结果分类

**Files:**
- Create: `src/release/upload-result.ts`
- Test: `src/release/upload-result.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `classifyUpload(exitCode: number, output: string, alreadyWaitedGap: boolean): "ok" | "retry" | "draft" | "fail"`，以及 `bvidFrom(output: string): string | null`

`ok` 要求退出码 0、输出含 `Web 接口投稿成功`、且 `bvidFrom` 非空，同时没有独立的限流码。`21566` 且 `alreadyWaitedGap` 为假时返回 `retry`。`137022`、输出含 `投稿过于频繁`、或 `21566` 且 `alreadyWaitedGap` 为真时返回 `draft`。数字必须用 `(?<!\\d)` 和 `(?!\\d)` 包住。

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { bvidFrom, classifyUpload } from "./upload-result";

test("文件大小里的 21566 不当成限流", () => {
  const output = "size 2156600\nWeb 接口投稿成功\nBV1YosU6REFN";
  assert.equal(classifyUpload(0, output, false), "ok");
  assert.equal(bvidFrom(output), "BV1YosU6REFN");
});

test("21566 先重试，隔过间隔后改草稿", () => {
  const output = "code 21566 投稿过于频繁";
  assert.equal(classifyUpload(1, output, false), "retry");
  assert.equal(classifyUpload(1, output, true), "draft");
  assert.equal(classifyUpload(1, "code 137022", false), "draft");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./scripts/register-ts.mjs --test src/release/upload-result.test.ts`  
Expected: FAIL，找不到 `./upload-result`

- [ ] **Step 3: Write minimal implementation**

`bvidFrom` 用 `/BV[0-9A-Za-z]{10}/` 取最后一个匹配。分类按上面的优先级：先认 `draft` 条件，再认 `retry`，再认 `ok`，其余 `fail`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./scripts/register-ts.mjs --test src/release/upload-result.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/release/upload-result.ts src/release/upload-result.test.ts
git commit -m "$(cat <<'EOF'
:sparkles: feat(release): 区分投稿成功、限流重试和改存草稿

EOF
)"
```

---

### Task 5: 两种批量的调度

**Files:**
- Create: `src/release/schedule.ts`
- Test: `src/release/schedule.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `UPLOAD_GAP_MS = 180_000` 和 `nextUpload(state: ScheduleState): ScheduleDecision`

```ts
type ScheduleState = {
  mode: "then" | "and";
  exportDone: boolean;
  uploading: boolean;
  now: number;
  lastUploadOkAt: number | null;
  pendingReady: string[];
};
type ScheduleDecision =
  | { type: "upload"; id: string }
  | { type: "wait"; ms: number }
  | { type: "idle" }
  | { type: "stop" };
```

`then` 在 `exportDone` 为假时返回 `idle`。`uploading` 为真时返回 `idle`。`pendingReady` 为空时，`exportDone` 返回 `stop`，否则 `idle`。`lastUploadOkAt` 距 `now` 不足 `UPLOAD_GAP_MS` 时返回剩余毫秒。否则上传 `pendingReady[0]`。

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { nextUpload, UPLOAD_GAP_MS } from "./schedule";

const base = {
  mode: "and" as const,
  exportDone: false,
  uploading: false,
  now: 1_000_000,
  lastUploadOkAt: null as number | null,
  pendingReady: ["a"],
};

test("导出后上传要等全部导出完", () => {
  assert.equal(nextUpload({ ...base, mode: "then" }).type, "idle");
  assert.deepEqual(nextUpload({ ...base, mode: "then", exportDone: true }), { type: "upload", id: "a" });
});

test("导出并上传在间隔未满时等待，投稿中不并行", () => {
  assert.deepEqual(nextUpload(base), { type: "upload", id: "a" });
  assert.deepEqual(
    nextUpload({ ...base, lastUploadOkAt: base.now - 60_000, pendingReady: ["b"] }),
    { type: "wait", ms: UPLOAD_GAP_MS - 60_000 },
  );
  assert.equal(nextUpload({ ...base, uploading: true }).type, "idle");
  assert.equal(nextUpload({ ...base, pendingReady: [], exportDone: true }).type, "stop");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./scripts/register-ts.mjs --test src/release/schedule.test.ts`  
Expected: FAIL，找不到 `./schedule`

- [ ] **Step 3: Write minimal implementation**

按接口说明的顺序写 `nextUpload`。不要在这里 `sleep`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./scripts/register-ts.mjs --test src/release/schedule.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/release/schedule.ts src/release/schedule.test.ts
git commit -m "$(cat <<'EOF'
:sparkles: feat(release): 导出后上传和导出并上传共用间隔调度

EOF
)"
```

---

### Task 6: 串行导出和入队

**Files:**
- Create: `src/release/export-batch.ts`
- Test: `src/release/export-batch.test.ts`
- Modify: `package.json` scripts，加 `"release": "nub src/release/cli.ts"`

**Interfaces:**
- Consumes: `ReleaseTrack`、`upsertPending`、`releaseItemId`、`hiresFor`、`dynamicForTrack`
- Produces: `exportAndEnqueue(options: { tracks: ReleaseTrack[]; outDir: string; prepareDir: string; overwriteVideo: boolean; exportVideo: (config: string, out: string) => Promise<void>; fileExists: (path: string) => boolean; probe: (audio: string) => Promise<{ lossless: boolean; sampleRate: number; bitsPerSample: number }>; readText: (path: string) => string; loadQueue: () => QueueFile; saveQueue: (queue: QueueFile) => void; onEnqueued: (id: string) => void }): Promise<void>`

成片路径是 `path.join(outDir, `${artistName}-${songName}.mkv`)`。封面把扩展名换成 `.jpg`。文件已存在且 `overwriteVideo` 为假时不调用 `exportVideo`。队列条目的 `created` 用调用方传入的时钟不测；实现里用 `new Date().toISOString()` 换成东八区 `YYYY-MM-DDTHH:mm:ss+08:00` 即可，测试不断言它。标题和简介从 txt 的 `标题\n` 与 `\n\n简介\n` 切开。`tag` 为 `歌手,专辑名,歌词视频,歌名`。某一首 `exportVideo` 拒绝时，函数把该错误抛出，且不再处理后面的曲目。

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./scripts/register-ts.mjs --test src/release/export-batch.test.ts`  
Expected: FAIL，找不到 `./export-batch`

- [ ] **Step 3: Write minimal implementation**

循环 `tracks`。先算成片路径。需要渲染时调用 `exportVideo(track.configPath, video)`。成功或跳过后调用 `onEnqueued`。`dynamicForTrack` 的 `already` 看当前队列里本批 id 是否已有非空 `dynamic`。不要在这个函数里抽帧，封面路径先写上，抽帧留在 Task 8 的 CLI 里、入队前调用。

修正：Task 6 的 `exportAndEnqueue` 接受可选 `writeCover: (track, video, cover) => Promise<void>`。测试里给出把它记到数组的实现。实现在入队前 `await writeCover`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./scripts/register-ts.mjs --test src/release/export-batch.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/release/export-batch.ts src/release/export-batch.test.ts package.json
git commit -m "$(cat <<'EOF'
:sparkles: feat(release): 串行导出并把每一首写入投稿队列

EOF
)"
```

---

### Task 7: 单首投稿循环

**Files:**
- Create: `src/release/upload-one.ts`
- Test: `src/release/upload-one.test.ts`

**Interfaces:**
- Consumes: `classifyUpload`、`bvidFrom`、`UPLOAD_GAP_MS`
- Produces: `uploadItem(item: QueueItem, deps: UploadDeps): Promise<{ status: "done"; bvid: string } | { status: "draft"; fromId: string }>`

`UploadDeps.run(command: string[]): Promise<{ exitCode: number; output: string }>`。`UploadDeps.sleep(ms: number): Promise<void>`。`UploadDeps.saveDraft(item: QueueItem): Promise<string>` 返回 `draft_id`。

`mode === "first"` 时命令是 `biliup -u <cookie> upload --submit web --copyright --tid --hires --cover --title --tag --desc`，`dynamic` 非空才加 `--dynamic`，最后是成片路径。`overwrite` 时命令换成 `biliup -u <cookie> append --submit web --vid <bvid>` 加成片路径。Task 9 在 append 成功后 `POST https://member.bilibili.com/x/vu/web/edit`，`videos` 只留新分 P，分 P 标题用 `biliup show <bvid>` 里原来的标题。分类为 `retry` 时 `sleep(UPLOAD_GAP_MS)` 后把 `alreadyWaitedGap` 设为真再跑一次。第二次仍不是 `ok` 就走 `saveDraft` 并返回 `draft`。`fail` 抛出 `Error`，消息含标题。

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./scripts/register-ts.mjs --test src/release/upload-one.test.ts`  
Expected: FAIL，找不到 `./upload-one`

- [ ] **Step 3: Write minimal implementation**

按接口写循环，最多跑两次。第一次 `alreadyWaitedGap` 为假。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./scripts/register-ts.mjs --test src/release/upload-one.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/release/upload-one.ts src/release/upload-one.test.ts
git commit -m "$(cat <<'EOF'
:sparkles: feat(release): 单首投稿遇限流先重试再改存草稿

EOF
)"
```

---

### Task 8: 合集加入的重试判断

**Files:**
- Create: `src/release/season.ts`
- Test: `src/release/season.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `classifySeasonAdd(exitCode: number, output: string): "ok" | "wait-rate" | "wait-missing" | "fail"`

输出含 `已将` 或 `已存在`，或独立数字 `20080`，返回 `ok`。独立数字 `20111` 或 `256000` 返回 `wait-rate`。含 `啥都木有` 或 `-404` 返回 `wait-missing`。其余 `fail`。

创建合集的 HTTP 放在同文件的 `ensureSeason(deps)`，但本任务只测分类函数。`ensureSeason` 的依赖是 `list`、`uploadCover`、`create`、`switchGroup`、`renameSection`，由 Task 9 的 CLI 注入真实请求。这里先把函数签名写成接受这些回调，没有测试用的网络。

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { classifySeasonAdd } from "./season";

test("新稿件查不到和编辑过于频繁都要重试这一次", () => {
  assert.equal(classifySeasonAdd(0, "已将 1 个稿件加入小节 1"), "ok");
  assert.equal(classifySeasonAdd(1, "code 256000"), "wait-rate");
  assert.equal(classifySeasonAdd(1, "code -404, message 啥都木有"), "wait-missing");
  assert.equal(classifySeasonAdd(1, "code 20092"), "fail");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./scripts/register-ts.mjs --test src/release/season.test.ts`  
Expected: FAIL，找不到 `./season`

- [ ] **Step 3: Write minimal implementation**

只实现 `classifySeasonAdd`。数字判断复用 `(?<!\\d)(20111|256000|20080)(?!\\d)`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./scripts/register-ts.mjs --test src/release/season.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/release/season.ts src/release/season.test.ts
git commit -m "$(cat <<'EOF'
:sparkles: feat(release): 区分合集加入的限流和稿件尚未可见

EOF
)"
```

---

### Task 9: CLI 把两种批量接起来

**Files:**
- Create: `src/release/cli.ts`
- Modify: `.agents/skills/single-track-batch/SKILL.md` 导出一节，把串行 `nub run export` 换成 `nub run release -- export-then-upload` 或 `export-and-upload`，并写明不要再为每张专辑新写脚本
- Modify: `AGENTS.md` 的「长时间导出和投稿」，补一句批量导出和投稿用 `nub run release`

**Interfaces:**
- Consumes: Task 1 到 Task 8 的全部导出函数
- Produces: `main(argv: string[]): Promise<void>`

子命令就是规格里的五个。`export` 调 `listReleaseTracks` 找不到单文件时，直接把该 json 当成一首，`index` 为 1。`upload` 用 id 或 `video` 路径找条目；找不到就退出码 1。`export-then-upload` 先 `ensureSeason`，再 `exportAndEnqueue`，全部成功后循环 `nextUpload`。`export-and-upload` 用同一个 `nextUpload`：导出循环在每首入队后把调度状态的 `pendingReady` 更新为磁盘上已存在的本批 pending，并在 `uploading` 为假时启动一首投稿。投稿函数自己 `await`，用一个布尔 `uploading` 防止第二首。`wait` 用 `setTimeout` 睡剩余时间，导出循环不被这个睡眠挡住：导出循环是主流程，投稿放进不 await 的 Promise 链里，每首导出后调用 `kick()`。`kick` 若 `uploading` 已真则返回；否则读 `nextUpload`，`wait` 就睡眠后再 `kick`，`upload` 就把 `uploading` 设真并在 `finally` 里设回假再 `kick`。导出循环结束后把 `exportDone` 设真再 `kick`，并等到 `uploading` 为假且 `nextUpload` 为 `stop`。

封面：入队前跑 `nub tmp/lyric-cover-time.ts`，失败或没有歌词则 `-ss 2`。抽帧命令是 `ffmpeg -y -ss <秒> -i <成片> -frames:v 1 -update 1 -q:v 2 <封面.jpg>`。

音轨探测用 `music-metadata` 的 `parseFile`。无损看 `codec` 或容器为 flac/alac/wav。采样率和位深用 `format.sampleRate` 和 `format.bitsPerSample`。

合集 HTTP 照 `tmp/setup-lala-season.py` 的地址：列出 `GET /x2/creative/web/seasons`，封面 `POST /x/vu/web/cover/up`，创建 `POST /x2/creative/web/season/add`，分组 `POST /x2/creative/web/season/section/switch`，改名 `POST /x2/creative/web/season/section/edit`。写操作成功后 `sleep 4` 秒。加入小节用 `biliup season add`，`wait-rate` 睡 30 秒，`wait-missing` 睡 30 秒，最多 16 次。

草稿：`GET /x/vupre/web/draft/list?pn=1&ps=30` 数 `data.length`。空位不够时只存空位那么多，终端打印还剩几条。`POST /x/vupre/web/draft/add?csrf=` 的正文用投稿 JSON，并带上本次 biliup 输出里的 `filename` 和 `cid`；没有这两个字段时抛错，不重新上传文件。

启动 `upload`、`export-then-upload`、`export-and-upload` 前用 `pgrep -fl "biliup upload|biliup append|src/release/cli.ts"`。除了自己的 pid 外还有匹配就打印「已有投稿在进行」并退出码 1。

- [ ] **Step 1: 写 cli 的参数失败测试**

`src/release/cli.test.ts` 只测 `parseReleaseArgs`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseReleaseArgs } from "./cli";

test("导出并上传收下备料目录", () => {
  assert.deepEqual(parseReleaseArgs(["export-and-upload", "预处理/寻雾"]), {
    command: "export-and-upload",
    target: "预处理/寻雾",
    overwriteVideo: false,
  });
});
```

先跑测试确认失败，再导出 `parseReleaseArgs`。未知子命令抛 `Error`，消息含五个子命令名。

- [ ] **Step 2: 把 main 接到已有函数**

按本任务的接口说明写 `main`。不要新写第二套调度。`parseFile`、`ffmpeg`、`biliup` 和合集请求都只出现在 `cli.ts` 或很薄的 `src/release/io.ts`。`io.ts` 若出现，只放进程和 HTTP，不放业务判断。

- [ ] **Step 3: 跑全部 release 测试**

Run: `node --import ./scripts/register-ts.mjs --test src/release/*.test.ts`  
Expected: PASS

- [ ] **Step 4: 改技能和 AGENTS**

`.agents/skills/single-track-batch/SKILL.md` 的导出节改为：用户确认导出后跑 `nub run release -- export-then-upload <备料目录>`；用户要导出的同时投稿时跑 `nub run release -- export-and-upload <备料目录>`。不要再为每张专辑写 `tmp/*-export.zsh` 或 `tmp/upload-*.py`。

`AGENTS.md`「长时间导出和投稿」加一句：批量用 `nub run release`，不要 `nohup`。

- [ ] **Step 5: Commit**

```bash
git add src/release/cli.ts src/release/cli.test.ts src/release/io.ts package.json .agents/skills/single-track-batch/SKILL.md AGENTS.md
git commit -m "$(cat <<'EOF'
:sparkles: feat(release): 提供导出后上传和导出并上传命令

EOF
)"
```

`io.ts` 若没有创建，就不要加进 `git add`。
