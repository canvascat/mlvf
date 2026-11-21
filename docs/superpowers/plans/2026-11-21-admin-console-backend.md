# 管理后台（后端）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出管理后台的后端：`node:sqlite` + Drizzle 的数据库、任务队列和 runner、导出/投稿执行器、空闲调度、tRPC 路由，并把 `release` CLI 改成读写同一个数据库。

**Architecture:** 两个进程共用一个 SQLite 文件。web 进程（TanStack Start，见前端计划）只通过 tRPC 往 `jobs` 表入队、读状态；runner 进程轮询 `jobs`，按 lane（`render`、`bili`）和并行数领取并执行。`release` CLI 与 runner 共用 `src/release/ops.ts` 里的投稿、合集、草稿逻辑，队列读写走 `QueueStore` 接口（数据库实现）。runner 以后想并入 web 进程，只需在 web 进程里调用同一个 `createRunner`。

**Tech Stack:** TypeScript、`node:sqlite`（`DatabaseSync`）、Drizzle ORM `1.0.0-rc.6`（`drizzle-orm/node-sqlite`）、`drizzle-kit`、tRPC v11、superjson、zod、`node:test`。

**Spec:** `docs/superpowers/specs/2026-11-21-admin-console-design.md`

## Global Constraints

- 命令在 Cursor 内置终端前台跑，不用 `nohup`、`disown`、`&`。runner 不使用 `detached` 子进程，终端一关子进程跟着退出。
- 测试命令统一 `node --import ./scripts/register-ts.mjs --test <文件>`；相对导入不写扩展名。
- 不改 AGENTS.md 的行为规则：`bili` lane 默认并行 1，`upload.minIntervalSec` 默认 180，合集写操作间隔默认 3 秒，投稿必须 `--submit web`。设置里偏离这些默认值只给警告，不拦。
- 所有登录态（`SESSDATA`、`bili_jct`、`csrf`、`access_key`、`refresh_token`）不得进入 `job_logs`，写日志前统一过 `redactSecrets`。
- `jobs.release_id` 不设外键：入队时 `releases` 行还没有，要等 `cover` 任务才建。
- 数据库文件 `data/rmv.db`（环境变量 `RMV_DB` 可改），整个 `data/` 进 `.gitignore`。
- web 进程不得导入 `admin/server/runner/**` 和 `src/export/render`（会把 Remotion 拉进 Vite SSR）。依赖方向：`routers` → `orchestrate`/`jobs`/`library`/`settings`；`runner/executors` → `src/release/ops`、`src/export/render`。
- 提交说明用 `:<gitmoji>: <type>(admin): <简体中文>`，不提交 `data/`。
- 运行时基线是 Node 26 LTS（Lithium，本机 v26.13.0）：Task 0 把 `engines` 改成 `>=26 <27`、`@types/node` 改成 26。本计划里的数据库代码已在 Node 26.13.0 上验证。
- TypeScript 保持 5.9.3，不升 7：`typescript-eslint`（当前最新 8.71.2，peer `typescript <6.1.0`）加载时对 TS 7 直接报 “does not support TS 7.0”，装了 7 会让 `eslint src` 整个跑不起来，且 nub 不会按 `overrides` 给它单独挂 5.9.3。等 typescript-eslint 支持 TS 7 后再单独升级，不放在本计划里。
- 保留工作区里 `src/release/upload-one.ts` 已有的未提交改动（`failUpload`），不要回退。

## File Structure

```text
drizzle.config.ts
admin/
  tsconfig.json
  server/
    boot.ts                  打开数据库、迁移、一次性导入旧队列
    db/{schema,client,instance}.ts, db/migrations/（drizzle-kit 生成）
    redact.ts  time.ts  settings.ts  jobs.ts  library.ts  queue-store.ts
    orchestrate.ts           把「导出/投稿」展开成带依赖的任务
    idle-scheduler.ts        空闲调度钩子
    changes.ts               给 SSE 用的变更轮询
    bili.ts                  草稿箱等只读接口
    paths.ts                 路径白名单
    runner/{types,index,idle,lock,progress,main}.ts
    runner/executors/{support,prepare,export,cover,season,upload,publish-draft,index}.ts
    trpc/{init,context}.ts, trpc/routers/*.ts, router.ts
  launcher.ts                一条命令起 web + runner
src/lib/process.ts           streamCommand / abortableSleep（从 runner 抽出，export 也要用）
src/release/store.ts         QueueStore 接口 + JSON 实现
src/release/ops.ts           从 cli.ts 抽出的投稿/合集/草稿/封面逻辑
```

---

## Task 0: 依赖与工程配置

**Files:**
- Modify: `package.json`, `tsconfig.json`, `.gitignore`, `.node-version`, `README.md`
- Create: `admin/tsconfig.json`, `drizzle.config.ts`

- [ ] **Step 0: 升到 Node 26 LTS 基线，先确认现有检查全绿**

把 `.node-version` 改成 `26`（与现有写法保持同一格式），`package.json` 的 `engines.node` 改成 `">=26 <27"`，`@types/node` 改成 `"26"`，`README.md` 第 18 行的 “Node 24 LTS” 改成 “Node 26 LTS”（`typescript` 不动，保持 5.9.3，原因见全局约束）。

```console
node -v
nub add -D @types/node@26
nub exec tsc
nub exec eslint src
node --import ./scripts/register-ts.mjs --test src/release/*.test.ts
```

Expected: `node -v` 为 v26.x；`tsc`、`eslint`、现有测试全部通过。如果 `@types/node@26` 引起现有代码的类型错误，只修类型错误本身，不改业务逻辑；改不动就停下来告诉用户。这一步单独提交：`:arrow_up: build(deps): 升级到 Node 26 LTS`。

- [ ] **Step 1: 安装后端依赖**

```console
nub add drizzle-orm@1.0.0-rc.6 @trpc/server@11.29.5 superjson
nub add -D drizzle-kit@1.0.0-rc.6
```

Expected: `package.json` 出现这三个依赖和一个 devDependency；`nub.lock` 更新。

- [ ] **Step 2: 根 `tsconfig.json`**

后端用到 `.at()`、`structuredClone`、`Array.prototype.toSorted` 等，`lib` 抬到 `es2023`；前端要 `@/` 别名；管理后台代码走单独的 `admin/tsconfig.json`，根配置不直接收录。

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "Preserve",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "lib": ["es2023", "dom"],
		"esModuleInterop": true,
		"resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noUnusedLocals": true,
    "paths": { "@/*": ["./admin/app/*"] }
  },
  "exclude": ["remotion.config.ts", "admin", "vite.config.mts", "drizzle.config.ts"]
}
```

- [ ] **Step 3: `admin/tsconfig.json`**

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["./**/*", "../vite.config.mts", "../drizzle.config.ts"],
  "exclude": ["./**/node_modules"]
}
```

`vite/client` 的类型要等前端计划装完 `vite` 才有，前端计划 Task 1 会把它加进 `types`。

- [ ] **Step 4: `.gitignore` 追加**

```gitignore

# 管理后台的数据库和 TanStack 缓存
data
.tanstack
```

- [ ] **Step 5: `package.json` scripts**

```json
"admin": "nub admin/launcher.ts",
"admin:web": "vite dev",
"admin:runner": "nub admin/server/runner/main.ts",
"admin:db": "drizzle-kit generate",
"lint": "eslint src && tsc && tsc -p admin"
```

（`lint` 在 Task 15 之前 `tsc -p admin` 会因为前端文件还不存在而只检查后端，没有问题。）

- [ ] **Step 6: 跑现有测试与类型检查，确认没被打坏**

Run: `nub exec tsc`  
Expected: 无输出。

Run: `node --import ./scripts/register-ts.mjs --test src/release/*.test.ts`  
Expected: 全部 pass。

- [ ] **Step 7: Commit**

```console
git add package.json nub.lock tsconfig.json admin/tsconfig.json .gitignore
git commit -m ":wrench: chore(admin): 引入 drizzle、trpc 并拆出管理后台的类型检查配置"
```

---

## Task 1: 数据库 schema 与连接

**Files:**
- Create: `admin/server/db/schema.ts`, `admin/server/db/client.ts`, `drizzle.config.ts`
- Test: `admin/server/db/schema.test.ts`

**Interfaces:**
- Produces: 表 `albums`、`tracks`、`releases`、`jobs`、`jobLogs`、`runnerState`、`settings`；类型 `AlbumRow`、`TrackRow`、`ReleaseRow`、`JobRow`、`JobKind`、`JobStatus`、`Lane`；`openDb(file?)`、`createDb`、`migrateDb`、`defaultDbFile()`、`Db`、`Tx`、`Conn`。
- 约束：`releases` 的 `track_id` 与 `album_id` 恰好一个非空（CHECK）；`runner_state` 只有 `id = 1` 一行；`releases.video` 唯一；`tracks.config_path` 唯一。

- [ ] **Step 1: 写测试 `admin/server/db/schema.test.ts`**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { openDb } from "./client";
import { albums, releases, runnerState, tracks } from "./schema";

const upload = { uploadTitle: "t", uploadDesc: "d", uploadTag: "g", uploadCover: "c.jpg" };
const base = { mode: "first", status: "pending", title: "t", createdAt: 1, ...upload } as const;

function seed() {
  const db = openDb(":memory:");
  const album = db.insert(albums).values({ prepareDir: "/p/a", title: "A", createdAt: 1 }).returning().get();
  const track = db.insert(tracks).values({ configPath: "/p/a/1.json", title: "T", createdAt: 1 }).returning().get();
  return { db, album, track };
}

test("releases 必须且只能属于一首歌或一张专辑", () => {
  const { db, album, track } = seed();
  db.insert(releases).values({ id: "a", video: "/a.mkv", trackId: track.id, ...base }).run();
  db.insert(releases).values({ id: "b", video: "/b.mkv", albumId: album.id, ...base }).run();
  assert.throws(() => db.insert(releases).values({ id: "c", video: "/c.mkv", ...base }).run());
  assert.throws(() => db.insert(releases).values({
    id: "d", video: "/d.mkv", trackId: track.id, albumId: album.id, ...base,
  }).run());
});

test("成片路径唯一", () => {
  const { db, track } = seed();
  db.insert(releases).values({ id: "a", video: "/a.mkv", trackId: track.id, ...base }).run();
  assert.throws(() => db.insert(releases).values({ id: "b", video: "/a.mkv", trackId: track.id, ...base }).run());
});

test("外键生效：不能指向不存在的曲目", () => {
  const { db } = seed();
  assert.throws(() => db.insert(releases).values({ id: "a", video: "/a.mkv", trackId: 999, ...base }).run());
});

test("runner_state 只有一行，迁移后已存在", () => {
  const db = openDb(":memory:");
  assert.equal(db.select().from(runnerState).all().length, 1);
  assert.throws(() => db.insert(runnerState).values({ id: 2 }).run());
});
```

- [ ] **Step 2: 写 `admin/server/db/schema.ts`**

```ts
import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const JOB_KINDS = [
  "prepare", "export", "cover", "season", "upload", "publish_draft",
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATUSES = [
  "queued", "running", "succeeded", "failed", "cancel_requested", "cancelled", "interrupted",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const LANES = ["render", "bili"] as const;
export type Lane = (typeof LANES)[number];

export const albums = sqliteTable("albums", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  prepareDir: text("prepare_dir").notNull().unique(),
  title: text("title").notNull(),
  artist: text("artist").notNull().default(""),
  year: integer("year"),
  genre: text("genre"),
  coverPath: text("cover_path"),
  trackCount: integer("track_count").notNull().default(0),
  seasonId: integer("season_id"),
  sectionId: integer("section_id"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
});

export const tracks = sqliteTable("tracks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  albumId: integer("album_id").references(() => albums.id),
  trackNo: integer("track_no"),
  prepareDir: text("prepare_dir").notNull().default(""),
  configPath: text("config_path").notNull().unique(),
  audioPath: text("audio_path").notNull().default(""),
  lyricPath: text("lyric_path"),
  coverPath: text("cover_path"),
  textPath: text("text_path"),
  title: text("title").notNull(),
  artist: text("artist").notNull().default(""),
  albumTitle: text("album_title").notNull().default(""),
  composer: text("composer"),
  year: integer("year"),
  genre: text("genre"),
  durationSec: real("duration_sec"),
  lyricOffsetMs: integer("lyric_offset_ms"),
  lyricSource: text("lyric_source"),
  lyricFormat: text("lyric_format"),
  audioSampleRate: integer("audio_sample_rate"),
  audioBits: integer("audio_bits"),
  audioLossless: integer("audio_lossless", { mode: "boolean" }),
  exportStatus: text("export_status", { enum: ["none", "exported", "failed"] })
    .notNull().default("none"),
  createdAt: integer("created_at").notNull(),
}, (t) => [index("tracks_album_idx").on(t.albumId)]);

export const releases = sqliteTable("releases", {
  id: text("id").primaryKey(),
  trackId: integer("track_id").references(() => tracks.id),
  albumId: integer("album_id").references(() => albums.id),
  mode: text("mode", { enum: ["first", "overwrite"] }).notNull(),
  status: text("status", { enum: ["pending", "draft", "done"] }).notNull(),
  video: text("video").notNull().unique(),
  title: text("title").notNull(),
  bvid: text("bvid"),
  draftId: text("draft_id"),
  seasonId: integer("season_id"),
  sectionId: integer("section_id"),
  seasonAdded: integer("season_added", { mode: "boolean" }),
  uploadTitle: text("upload_title").notNull(),
  uploadDesc: text("upload_desc").notNull(),
  uploadTag: text("upload_tag").notNull(),
  uploadCover: text("upload_cover").notNull(),
  uploadTid: integer("upload_tid").notNull().default(130),
  uploadCopyright: integer("upload_copyright").notNull().default(1),
  uploadDynamic: text("upload_dynamic").notNull().default(""),
  uploadHires: integer("upload_hires").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  finishedAt: integer("finished_at"),
}, (t) => [
  check("releases_owner", sql`(${t.trackId} IS NOT NULL) <> (${t.albumId} IS NOT NULL)`),
  index("releases_status_idx").on(t.status),
]);

export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: JOB_KINDS }).notNull(),
  lane: text("lane", { enum: LANES }).notNull(),
  status: text("status", { enum: JOB_STATUSES }).notNull().default("queued"),
  albumId: integer("album_id").references(() => albums.id),
  trackId: integer("track_id").references(() => tracks.id),
  /** 不设外键：入队时 releases 行还没建，要等 cover 任务才建。 */
  releaseId: text("release_id"),
  dependsOn: text("depends_on", { mode: "json" }).$type<number[]>().notNull(),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  progress: real("progress").notNull().default(0),
  result: text("result", { mode: "json" }).$type<unknown>(),
  error: text("error"),
  attempt: integer("attempt").notNull().default(0),
  runAfter: integer("run_after").notNull().default(0),
  retryOf: integer("retry_of"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  startedAt: integer("started_at"),
  finishedAt: integer("finished_at"),
}, (t) => [
  index("jobs_claim_idx").on(t.lane, t.status, t.runAfter),
  index("jobs_updated_idx").on(t.updatedAt),
]);

export const jobLogs = sqliteTable("job_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull().references(() => jobs.id),
  ts: integer("ts").notNull(),
  stream: text("stream", { enum: ["stdout", "stderr", "system"] }).notNull(),
  line: text("line").notNull(),
}, (t) => [index("job_logs_job_idx").on(t.jobId, t.id)]);

export const runnerState = sqliteTable("runner_state", {
  id: integer("id").primaryKey(),
  lockedSince: integer("locked_since"),
  holdUntil: integer("hold_until"),
  lastUploadOkAt: integer("last_upload_ok_at"),
  pid: integer("pid"),
  heartbeatAt: integer("heartbeat_at"),
}, (t) => [check("runner_state_single", sql`${t.id} = 1`)]);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>().notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type AlbumRow = typeof albums.$inferSelect;
export type TrackRow = typeof tracks.$inferSelect;
export type ReleaseRow = typeof releases.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
```

- [ ] **Step 3: 写 `admin/server/db/client.ts` 和 `drizzle.config.ts`**

```ts
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";

export function createDb(file: string) {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const client = new DatabaseSync(file);
  client.exec("PRAGMA busy_timeout = 5000;");
  if (file !== ":memory:") client.exec("PRAGMA journal_mode = WAL;");
  client.exec("PRAGMA foreign_keys = ON;");
  return drizzle({ client });
}

export type Db = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Conn = Db | Tx;

const MIGRATIONS = fileURLToPath(new URL("./migrations", import.meta.url));

export function migrateDb(db: Db): void {
  const failure = migrate(db, { migrationsFolder: MIGRATIONS });
  if (failure) throw new Error(`数据库迁移失败: ${JSON.stringify(failure)}`);
  db.run("INSERT OR IGNORE INTO runner_state (id) VALUES (1)");
}

export function defaultDbFile(): string {
  return process.env.RMV_DB ?? path.join(process.cwd(), "data", "rmv.db");
}

export function openDb(file: string = defaultDbFile()): Db {
  const db = createDb(file);
  migrateDb(db);
  return db;
}
```

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./admin/server/db/schema.ts",
  out: "./admin/server/db/migrations",
});
```

- [ ] **Step 4: 生成迁移**

Run: `nub exec drizzle-kit generate`  
Expected: 生成 `admin/server/db/migrations/<时间戳>_<名字>/migration.sql` 与 `snapshot.json`。迁移文件要提交。

- [ ] **Step 5: 跑测试**

Run: `node --import ./scripts/register-ts.mjs --test admin/server/db/schema.test.ts`  
Expected: 4 个测试 pass。

- [ ] **Step 6: Commit**

```console
git add drizzle.config.ts admin/server/db
git commit -m ":sparkles: feat(admin): 添加 SQLite 数据表和 Drizzle 迁移"
```

---

## Task 2: 脱敏与时间工具

**Files:**
- Create: `admin/server/redact.ts`, `admin/server/time.ts`
- Test: `admin/server/redact.test.ts`

**Interfaces:**
- Produces: `redactSecrets(text)`；`toShanghaiIso(ms)`、`fromIso(text)`（没有时区的旧字符串按 +08:00 解析）。

- [ ] **Step 1: 写测试 `admin/server/redact.test.ts`**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { redactSecrets } from "./redact";

test("遮住登录态和 csrf，其他内容原样保留", () => {
  assert.equal(redactSecrets("Cookie: SESSDATA=abc; bili_jct=def"), "Cookie: ***");
  assert.equal(redactSecrets('{"bili_jct":"def","x":1}'), '{"bili_jct":"***","x":1}');
  assert.equal(redactSecrets("POST /x?csrf=abc123&a=1"), "POST /x?csrf=***&a=1");
  assert.equal(redactSecrets("access_key=zzz refresh_token: yyy"), "access_key=*** refresh_token: ***");
  assert.equal(redactSecrets("Rendered 12/100"), "Rendered 12/100");
});
```

- [ ] **Step 2: 写实现**

```ts
const RULES: [RegExp, string][] = [
  [/(bili_jct|SESSDATA|DedeUserID(?:__ckMd5)?|access_token|access_key|refresh_token)(["']?\s*[:=]\s*["']?)([^"'\s;,&}]+)/gi, "$1$2***"],
  [/(csrf=)[^&\s"']+/gi, "$1***"],
  [/(Cookie:\s*).+/gi, "$1***"],
];

export function redactSecrets(text: string): string {
  return RULES.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}
```

```ts
const FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hourCycle: "h23",
});

/** 毫秒时间戳转成队列里一直在用的 `YYYY-MM-DDTHH:mm:ss+08:00`。 */
export function toShanghaiIso(ms: number): string {
  const parts = FORMAT.formatToParts(new Date(ms));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick("minute")}:${pick("second")}+08:00`;
}

/** 解析队列里的时间。没有时区的旧数据按东八区算。 */
export function fromIso(text: string): number {
  const hasZone = /(Z|[+-]\d\d:?\d\d)$/.test(text);
  const ms = Date.parse(hasZone ? text : `${text}+08:00`);
  if (!Number.isFinite(ms)) throw new Error(`无法解析时间: ${text}`);
  return ms;
}
```

- [ ] **Step 3: 跑测试**

Run: `node --import ./scripts/register-ts.mjs --test admin/server/redact.test.ts`  
Expected: pass。

- [ ] **Step 4: Commit**

```console
git add admin/server/redact.ts admin/server/redact.test.ts admin/server/time.ts
git commit -m ":sparkles: feat(admin): 添加日志脱敏与上海时区时间工具"
```

---

## Task 3: 设置

**Files:**
- Create: `admin/server/settings.ts`
- Test: `admin/server/settings.test.ts`

**Interfaces:**
- Consumes: `settings` 表。
- Produces: `getSettings(db)`、`updateSettings(db, patch, now?)`（校验并保证 `idle.nightStartHour < idle.nightEndHour`，事务写入）、`resetSettings(db, keys?)`、`settingWarnings(settings)`、`settingUpdatedAt(db)`、`SETTING_DEFAULTS`、`SETTING_KEYS`、类型 `Settings`。

- [ ] **Step 1: 写测试 `admin/server/settings.test.ts`**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { openDb } from "./db/client";
import { getSettings, resetSettings, SETTING_DEFAULTS, settingWarnings, updateSettings } from "./settings";

test("没有记录时返回默认值", () => {
  assert.deepEqual(getSettings(openDb(":memory:")), SETTING_DEFAULTS);
});

test("更新后立即读到，其余保持默认", () => {
  const db = openDb(":memory:");
  const next = updateSettings(db, { "upload.minIntervalSec": 240, "idle.enabled": false });
  assert.equal(next["upload.minIntervalSec"], 240);
  assert.equal(next["idle.enabled"], false);
  assert.equal(next["bili.maxParallel"], 1);
});

test("非法值被拒绝且不落库", () => {
  const db = openDb(":memory:");
  assert.throws(() => updateSettings(db, { "render.maxParallel": 0 }), /render\.maxParallel/);
  assert.throws(() => updateSettings(db, { "render.frameConcurrency": "abc" }), /数字或百分比/);
  assert.throws(() => updateSettings(db, { "idle.nightStartHour": 7 }), /小于/);
  assert.deepEqual(getSettings(db), SETTING_DEFAULTS);
});

test("恢复默认，可只恢复部分", () => {
  const db = openDb(":memory:");
  updateSettings(db, { "upload.minIntervalSec": 10, "season.writeIntervalSec": 9 });
  assert.equal(resetSettings(db, ["upload.minIntervalSec"])["upload.minIntervalSec"], 180);
  assert.equal(getSettings(db)["season.writeIntervalSec"], 9);
  assert.deepEqual(resetSettings(db), SETTING_DEFAULTS);
});

test("偏离默认值时给出警告", () => {
  const db = openDb(":memory:");
  assert.deepEqual(settingWarnings(getSettings(db)), []);
  const warned = settingWarnings(updateSettings(db, { "upload.minIntervalSec": 60, "bili.maxParallel": 2 }));
  assert.deepEqual(warned.map((w) => w.key), ["upload.minIntervalSec", "bili.maxParallel"]);
});
```

- [ ] **Step 2: 写 `admin/server/settings.ts`**

```ts
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Conn, Db } from "./db/client";
import { settings as settingsTable } from "./db/schema";

const int = (min: number, max: number) => z.number().int().min(min).max(max);

export const settingsShape = {
  "render.maxParallel": int(1, 8),
  "render.frameConcurrency": z.string().regex(/^(\d+|\d+%)$/, "填数字或百分比，如 2 或 50%"),
  "bili.maxParallel": int(1, 8),
  "upload.minIntervalSec": int(0, 86_400),
  "season.writeIntervalSec": int(0, 600),
  "retry.rateLimitWaitSec": int(0, 3600),
  "retry.editBusyWaitSec": int(0, 600),
  "retry.notFoundWaitSec": int(0, 600),
  "idle.enabled": z.boolean(),
  "idle.nightStartHour": int(0, 23),
  "idle.nightEndHour": int(1, 24),
  "idle.lockMinutes": int(1, 1440),
  "idle.tickSec": int(5, 3600),
  "draft.capacity": int(1, 100),
  "log.maxLinesPerJob": int(100, 100_000),
  "bin.biliup": z.string().min(1),
  "bin.ffmpeg": z.string().min(1),
} as const;

export type Settings = { [K in keyof typeof settingsShape]: z.infer<(typeof settingsShape)[K]> };
export type SettingKey = keyof Settings;

export const SETTING_DEFAULTS: Settings = {
  "render.maxParallel": 1,
  "render.frameConcurrency": "1",
  "bili.maxParallel": 1,
  "upload.minIntervalSec": 180,
  "season.writeIntervalSec": 3,
  "retry.rateLimitWaitSec": 180,
  "retry.editBusyWaitSec": 20,
  "retry.notFoundWaitSec": 30,
  "idle.enabled": true,
  "idle.nightStartHour": 0,
  "idle.nightEndHour": 6,
  "idle.lockMinutes": 10,
  "idle.tickSec": 60,
  "draft.capacity": 30,
  "log.maxLinesPerJob": 5000,
  "bin.biliup": "biliup",
  "bin.ffmpeg": "ffmpeg",
};

export const SETTING_KEYS = Object.keys(settingsShape) as SettingKey[];

export function getSettings(conn: Conn): Settings {
  const stored = new Map(conn.select().from(settingsTable).all().map((row) => [row.key, row.value]));
  const result: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    const parsed = settingsShape[key].safeParse(stored.get(key));
    result[key] = parsed.success ? parsed.data : SETTING_DEFAULTS[key];
  }
  return result as Settings;
}

export function updateSettings(db: Db, patch: Partial<Settings>, now: number = Date.now()): Settings {
  const entries = Object.entries(patch) as [SettingKey, unknown][];
  for (const [key, value] of entries) {
    if (!(key in settingsShape)) throw new Error(`未知配置项: ${key}`);
    const parsed = settingsShape[key].safeParse(value);
    if (!parsed.success) throw new Error(`${key}: ${parsed.error.issues[0]?.message ?? "取值不合法"}`);
  }
  const merged = { ...getSettings(db), ...patch };
  if (merged["idle.nightStartHour"] >= merged["idle.nightEndHour"]) {
    throw new Error("idle.nightStartHour 必须小于 idle.nightEndHour");
  }
  db.transaction((tx) => {
    for (const [key, value] of entries) {
      tx.insert(settingsTable).values({ key, value, updatedAt: now })
        .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: now } }).run();
    }
  });
  return getSettings(db);
}

export function resetSettings(db: Db, keys?: SettingKey[]): Settings {
  if (keys) db.delete(settingsTable).where(inArray(settingsTable.key, keys)).run();
  else db.delete(settingsTable).run();
  return getSettings(db);
}

export type SettingWarning = { key: SettingKey; message: string };

export function settingWarnings(settings: Settings): SettingWarning[] {
  const warnings: SettingWarning[] = [];
  if (settings["upload.minIntervalSec"] < 180) {
    warnings.push({ key: "upload.minIntervalSec", message: "低于 180 秒容易触发 21566、137022 投稿过于频繁" });
  }
  if (settings["bili.maxParallel"] > 1) {
    warnings.push({ key: "bili.maxParallel", message: "AGENTS.md 要求不并行投稿，并行容易触发 21566" });
  }
  if (settings["render.maxParallel"] > 1) {
    warnings.push({ key: "render.maxParallel", message: "多路同时渲染会占用大量内存和 Chrome 进程" });
  }
  return warnings;
}

export function settingUpdatedAt(conn: Conn, key: SettingKey): number | null {
  return conn.select().from(settingsTable).where(eq(settingsTable.key, key)).get()?.updatedAt ?? null;
}
```

- [ ] **Step 3: 跑测试**

Run: `node --import ./scripts/register-ts.mjs --test admin/server/settings.test.ts`  
Expected: 5 个测试 pass。

- [ ] **Step 4: Commit**

```console
git add admin/server/settings.ts admin/server/settings.test.ts
git commit -m ":sparkles: feat(admin): 添加可热更新的设置并对偏离默认值给出警告"
```

---

## Task 4: 任务队列

**Files:**
- Create: `admin/server/jobs.ts`
- Test: `admin/server/jobs.test.ts`

**Interfaces:**
- Consumes: Task 1、Task 2。
- Produces: `enqueueJob`、`getJob`、`claimNext(conn, lane, now)`（原子领取，依赖用 `json_each`）、`countRunning`、`finishJob`（非成功时级联取消依赖它的任务，错误写 `依赖失败: #<id>`）、`requestCancel`、`cancelRequestedIds`、`setProgress`、`retryJob`（新建一条，`retry_of` 指向原条，并把被级联取消的下游重新接到新条上）、`recoverInterrupted`、`appendLogs`（脱敏并按上限裁剪）、`listLogs`。

- [ ] **Step 1: 写测试 `admin/server/jobs.test.ts`**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { openDb } from "./db/client";
import {
  appendLogs, cancelRequestedIds, claimNext, countRunning, enqueueJob, finishJob, getJob,
  listLogs, recoverInterrupted, requestCancel, retryJob,
} from "./jobs";

const fresh = () => openDb(":memory:");

test("按 id 顺序领取，且只领一次", () => {
  const db = fresh();
  const a = enqueueJob(db, { kind: "export" });
  const b = enqueueJob(db, { kind: "export" });
  assert.equal(claimNext(db, "render", 1)?.id, a.id);
  assert.equal(claimNext(db, "render", 1)?.id, b.id);
  assert.equal(claimNext(db, "render", 1), undefined);
  assert.equal(countRunning(db, "render"), 2);
});

test("lane 互不干扰", () => {
  const db = fresh();
  enqueueJob(db, { kind: "upload" });
  assert.equal(claimNext(db, "render", 1), undefined);
  assert.equal(claimNext(db, "bili", 1)?.kind, "upload");
});

test("依赖未成功或 run_after 未到时不领取", () => {
  const db = fresh();
  const a = enqueueJob(db, { kind: "export" });
  const b = enqueueJob(db, { kind: "cover", dependsOn: [a.id] });
  const late = enqueueJob(db, { kind: "prepare", runAfter: 5000 });
  assert.equal(claimNext(db, "render", 100)?.id, a.id);
  assert.equal(claimNext(db, "render", 100), undefined);
  finishJob(db, a.id, { status: "succeeded" }, 200);
  assert.equal(claimNext(db, "render", 300)?.id, b.id);
  assert.equal(claimNext(db, "render", 300), undefined);
  assert.equal(claimNext(db, "render", 6000)?.id, late.id);
});

test("依赖失败会一路级联取消，已入队但不依赖它的不受影响", () => {
  const db = fresh();
  const e1 = enqueueJob(db, { kind: "export" });
  const u1 = enqueueJob(db, { kind: "upload", dependsOn: [e1.id] });
  const u2 = enqueueJob(db, { kind: "upload", dependsOn: [u1.id] });
  const free = enqueueJob(db, { kind: "upload" });
  claimNext(db, "render", 1);
  finishJob(db, e1.id, { status: "failed", error: "boom" }, 2);
  assert.equal(getJob(db, u1.id)?.status, "cancelled");
  assert.match(getJob(db, u1.id)?.error ?? "", /依赖失败: #1/);
  assert.equal(getJob(db, u2.id)?.status, "cancelled");
  assert.equal(getJob(db, free.id)?.status, "queued");
});

test("取消：排队直接取消，运行中先标记请求", () => {
  const db = fresh();
  const a = enqueueJob(db, { kind: "export" });
  const b = enqueueJob(db, { kind: "export" });
  claimNext(db, "render", 1);
  assert.equal(requestCancel(db, b.id, 2), "cancelled");
  assert.equal(requestCancel(db, a.id, 2), "requested");
  assert.deepEqual(cancelRequestedIds(db), [a.id]);
  assert.equal(requestCancel(db, a.id, 3), "noop");
});

test("重试：新建任务、改指依赖并复活被级联取消的后续任务", () => {
  const db = fresh();
  const e1 = enqueueJob(db, { kind: "export", payload: { x: 1 } });
  const u1 = enqueueJob(db, { kind: "upload", dependsOn: [e1.id] });
  const u2 = enqueueJob(db, { kind: "upload", dependsOn: [u1.id] });
  claimNext(db, "render", 1);
  finishJob(db, e1.id, { status: "failed", error: "boom" }, 2);
  const again = retryJob(db, e1.id, 3);
  assert.equal(again.retryOf, e1.id);
  assert.deepEqual(again.payload, { x: 1 });
  assert.deepEqual(getJob(db, u1.id)?.dependsOn, [again.id]);
  assert.equal(getJob(db, u1.id)?.status, "queued");
  assert.equal(getJob(db, u2.id)?.status, "queued");
  assert.throws(() => retryJob(db, again.id, 4), /只有失败/);
});

test("启动恢复：running 变 interrupted 并级联", () => {
  const db = fresh();
  const a = enqueueJob(db, { kind: "export" });
  const b = enqueueJob(db, { kind: "cover", dependsOn: [a.id] });
  claimNext(db, "render", 1);
  assert.equal(recoverInterrupted(db, 9), 1);
  assert.equal(getJob(db, a.id)?.status, "interrupted");
  assert.equal(getJob(db, b.id)?.status, "cancelled");
});

test("日志脱敏并只保留最近 N 行", () => {
  const db = fresh();
  const a = enqueueJob(db, { kind: "upload" });
  appendLogs(db, a.id, [{ stream: "stdout", line: "bili_jct=abc123 csrf=zzz" }], 1, 3);
  assert.equal(listLogs(db, a.id, 0)[0]?.line, "bili_jct=*** csrf=***");
  for (let i = 0; i < 10; i += 1) appendLogs(db, a.id, [{ stream: "stdout", line: `l${i}` }], 2, 3);
  assert.deepEqual(listLogs(db, a.id, 0).map((row) => row.line), ["l7", "l8", "l9"]);
});
```

- [ ] **Step 2: 写 `admin/server/jobs.ts`**

```ts
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Conn, Db } from "./db/client";
import { jobLogs, jobs, type JobKind, type JobRow, type Lane } from "./db/schema";
import { redactSecrets } from "./redact";

const RENDER_KINDS = new Set<JobKind>(["prepare", "export", "cover"]);

export function laneOf(kind: JobKind): Lane {
  return RENDER_KINDS.has(kind) ? "render" : "bili";
}

export type NewJob = {
  kind: JobKind;
  albumId?: number;
  trackId?: number;
  releaseId?: string;
  dependsOn?: number[];
  payload?: Record<string, unknown>;
  runAfter?: number;
  retryOf?: number;
};

export function enqueueJob(conn: Conn, job: NewJob, now: number = Date.now()): JobRow {
  return conn.insert(jobs).values({
    kind: job.kind,
    lane: laneOf(job.kind),
    albumId: job.albumId ?? null,
    trackId: job.trackId ?? null,
    releaseId: job.releaseId ?? null,
    dependsOn: job.dependsOn ?? [],
    payload: job.payload ?? {},
    runAfter: job.runAfter ?? 0,
    retryOf: job.retryOf ?? null,
    createdAt: now,
    updatedAt: now,
  }).returning().get();
}

export function getJob(conn: Conn, id: number): JobRow | undefined {
  return conn.select().from(jobs).where(eq(jobs.id, id)).get();
}

/** 原子领取：同一条语句里挑出并改成 running，所以同一个任务只会被一个调用者拿到。 */
export function claimNext(conn: Conn, lane: Lane, now: number): JobRow | undefined {
  return conn.update(jobs)
    .set({
      status: "running",
      startedAt: now,
      updatedAt: now,
      finishedAt: null,
      error: null,
      progress: 0,
      attempt: sql`${jobs.attempt} + 1`,
    })
    .where(eq(jobs.id, sql`(
      SELECT j.id FROM jobs AS j
      WHERE j.lane = ${lane} AND j.status = 'queued' AND j.run_after <= ${now}
        AND NOT EXISTS (
          SELECT 1 FROM json_each(j.depends_on) AS d
          JOIN jobs AS p ON p.id = d.value
          WHERE p.status <> 'succeeded')
      ORDER BY j.id LIMIT 1)`))
    .returning().all()[0];
}

export function countRunning(conn: Conn, lane: Lane): number {
  const row = conn.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(jobs)
    .where(and(eq(jobs.lane, lane), inArray(jobs.status, ["running", "cancel_requested"])))
    .get();
  return row?.n ?? 0;
}

export type JobOutcome =
  | { status: "succeeded"; result?: unknown }
  | { status: "failed"; error: string }
  | { status: "cancelled" }
  | { status: "interrupted"; error?: string };

export function finishJob(db: Db, id: number, outcome: JobOutcome, now: number): void {
  db.transaction((tx) => {
    const error = outcome.status === "failed" ? outcome.error
      : outcome.status === "cancelled" ? "已取消"
      : outcome.status === "interrupted" ? (outcome.error ?? "任务被中断")
      : null;
    tx.update(jobs).set({
      status: outcome.status,
      error,
      finishedAt: now,
      updatedAt: now,
      ...(outcome.status === "succeeded"
        ? { progress: 1, result: outcome.result ?? null }
        : {}),
    }).where(eq(jobs.id, id)).run();
    if (outcome.status !== "succeeded") cascadeDependencyFailures(tx, now);
  });
}

const BAD = "('failed','cancelled','interrupted')";

/** 依赖已失败、取消或中断的排队任务，一路改成 cancelled（原因「依赖失败」）。 */
export function cascadeDependencyFailures(conn: Conn, now: number): number {
  let total = 0;
  for (;;) {
    const stuck = conn.all<{ id: number | bigint; dep: number | bigint }>(sql`
      SELECT j.id AS id,
        (SELECT p.id FROM json_each(j.depends_on) AS d JOIN jobs AS p ON p.id = d.value
          WHERE p.status IN ${sql.raw(BAD)} LIMIT 1) AS dep
      FROM jobs AS j
      WHERE j.status = 'queued' AND EXISTS (
        SELECT 1 FROM json_each(j.depends_on) AS d JOIN jobs AS p ON p.id = d.value
        WHERE p.status IN ${sql.raw(BAD)})`);
    if (stuck.length === 0) return total;
    for (const row of stuck) {
      conn.update(jobs).set({
        status: "cancelled",
        error: `依赖失败: #${Number(row.dep)}`,
        finishedAt: now,
        updatedAt: now,
      }).where(eq(jobs.id, Number(row.id))).run();
      total += 1;
    }
  }
}

export function requestCancel(db: Db, id: number, now: number): "cancelled" | "requested" | "noop" {
  return db.transaction((tx) => {
    const job = getJob(tx, id);
    if (!job) return "noop";
    if (job.status === "queued") {
      tx.update(jobs).set({ status: "cancelled", error: "已取消", finishedAt: now, updatedAt: now })
        .where(eq(jobs.id, id)).run();
      cascadeDependencyFailures(tx, now);
      return "cancelled";
    }
    if (job.status === "running") {
      tx.update(jobs).set({ status: "cancel_requested", updatedAt: now }).where(eq(jobs.id, id)).run();
      return "requested";
    }
    return "noop";
  });
}

export function cancelRequestedIds(conn: Conn): number[] {
  return conn.select({ id: jobs.id }).from(jobs)
    .where(eq(jobs.status, "cancel_requested")).all().map((row) => row.id);
}

export function setProgress(conn: Conn, id: number, progress: number, now: number): void {
  const clamped = Math.min(1, Math.max(0, progress));
  conn.update(jobs).set({ progress: clamped, updatedAt: now }).where(eq(jobs.id, id)).run();
}

const isCascaded = (job: JobRow) =>
  job.status === "cancelled" && (job.error ?? "").startsWith("依赖失败");

/** 重试：新建一条任务，并把依赖旧任务的后续任务改指向新任务、必要时复活。 */
export function retryJob(db: Db, id: number, now: number): JobRow {
  return db.transaction((tx) => {
    const old = getJob(tx, id);
    if (!old) throw new Error(`找不到任务 #${id}`);
    if (!["failed", "cancelled", "interrupted"].includes(old.status)) {
      throw new Error("只有失败、取消或中断的任务可以重试");
    }
    const fresh = enqueueJob(tx, {
      kind: old.kind,
      albumId: old.albumId ?? undefined,
      trackId: old.trackId ?? undefined,
      releaseId: old.releaseId ?? undefined,
      dependsOn: old.dependsOn,
      payload: old.payload,
      retryOf: old.id,
    }, now);
    const dependents = tx.select().from(jobs).where(sql`EXISTS (
      SELECT 1 FROM json_each(${jobs.dependsOn}) AS d WHERE d.value = ${old.id})`).all();
    for (const dependent of dependents) {
      if (dependent.status !== "queued" && !isCascaded(dependent)) continue;
      tx.update(jobs).set({
        dependsOn: dependent.dependsOn.map((dep) => (dep === old.id ? fresh.id : dep)),
        updatedAt: now,
      }).where(eq(jobs.id, dependent.id)).run();
    }
    reviveCascaded(tx, now);
    return fresh;
  });
}

function reviveCascaded(conn: Conn, now: number): void {
  const candidates = conn.select().from(jobs).where(eq(jobs.status, "cancelled"))
    .orderBy(asc(jobs.id)).all().filter(isCascaded);
  for (const job of candidates) {
    const deps = job.dependsOn.map((dep) => getJob(conn, dep)?.status);
    const alive = deps.every((status) =>
      status === undefined || ["queued", "running", "succeeded", "cancel_requested"].includes(status));
    if (!alive) continue;
    conn.update(jobs).set({ status: "queued", error: null, finishedAt: null, updatedAt: now })
      .where(eq(jobs.id, job.id)).run();
  }
}

export function recoverInterrupted(db: Db, now: number): number {
  return db.transaction((tx) => {
    const hit = tx.update(jobs).set({
      status: "interrupted",
      error: "任务被中断（runner 重启或退出）",
      finishedAt: now,
      updatedAt: now,
    }).where(inArray(jobs.status, ["running", "cancel_requested"])).returning({ id: jobs.id }).all();
    cascadeDependencyFailures(tx, now);
    return hit.length;
  });
}

export type LogEntry = { stream: "stdout" | "stderr" | "system"; line: string };

export function appendLogs(
  conn: Conn,
  jobId: number,
  entries: LogEntry[],
  now: number,
  maxLines: number,
): void {
  if (entries.length === 0) return;
  conn.insert(jobLogs).values(entries.map((entry) => ({
    jobId, ts: now, stream: entry.stream, line: redactSecrets(entry.line),
  }))).run();
  conn.delete(jobLogs).where(and(
    eq(jobLogs.jobId, jobId),
    sql`${jobLogs.id} <= (SELECT id FROM job_logs WHERE job_id = ${jobId}
      ORDER BY id DESC LIMIT 1 OFFSET ${maxLines})`,
  )).run();
}

export function listLogs(conn: Conn, jobId: number, afterId: number, limit = 500) {
  return conn.select().from(jobLogs)
    .where(and(eq(jobLogs.jobId, jobId), gt(jobLogs.id, afterId)))
    .orderBy(asc(jobLogs.id)).limit(limit).all();
}
```

- [ ] **Step 3: 跑测试**

Run: `node --import ./scripts/register-ts.mjs --test admin/server/jobs.test.ts`  
Expected: 8 个测试 pass。

> 已知坑（沙盒里踩过，代码已处理，不要改回去）：`count(*)` 在 node:sqlite 里是 BigInt，要 `.mapWith(Number)`；级联查询里的 `depends_on` 必须带表别名，否则子查询绑错表。

- [ ] **Step 4: Commit**

```console
git add admin/server/jobs.ts admin/server/jobs.test.ts
git commit -m ":sparkles: feat(admin): 添加带依赖和级联取消的任务队列"
```

---

## Task 5: QueueStore 与旧队列导入

**Files:**
- Create: `src/release/store.ts`, `admin/server/queue-store.ts`
- Test: `admin/server/queue-store.test.ts`

**Interfaces:**
- Consumes: `src/release/queue.ts` 的 `QueueFile`/`QueueItem`/`batchKey`。
- Produces: `QueueStore { load(); save(queue); patch(id, update) }`、`jsonQueueStore(file)`、`createDbQueueStore(db)`、`importQueueJson(db, file, now?)`。
- 语义：
  - `load()` 给每个条目对象记下读出来时的内容；`save()` 只写与该内容不同的条目，没有记录的（新建，或 `upsertPending` 展开出的新对象里的新条目）和库里当前内容比。长时间持有旧快照再 `save` 不会覆盖别处的更新。
  - `patch()` 在一个事务里读-改-写单条。
  - `importQueueJson` 幂等（按 `id` 与 `video` 去重），事务提交后把文件改名为 `.imported`，出错整体回滚；旧队列里没有对应曲目的条目会建占位曲目（`config_path = legacy:<video>`），能按 `release-<hash>-<NN>` 对上备料目录时用真实曲目。

- [ ] **Step 1: 写测试 `admin/server/queue-store.test.ts`**

```ts
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import type { QueueFile, QueueItem } from "../../src/release/queue";
import { openDb } from "./db/client";
import { releases, tracks } from "./db/schema";
import { createDbQueueStore, importQueueJson } from "./queue-store";

const item = (id: string, patch: Partial<QueueItem> = {}): QueueItem => ({
  id, mode: "first", status: "pending", video: `/out/${id}.mkv`, title: id,
  created: "2026-11-19T10:00:00+08:00",
  upload: { title: id, desc: "d", tag: "t", cover: `/out/${id}.jpg`, tid: 130, copyright: 1, dynamic: "", hires: 0 },
  ...patch,
});

test("保存再读取，条目内容不变", () => {
  const store = createDbQueueStore(openDb(":memory:"));
  const queue = store.load();
  queue.items.push(item("a", { bvid: "BV1xx", season_id: 1, section_id: 2, season_added: false }));
  store.save(queue);
  assert.deepEqual(store.load().items, [item("a", { bvid: "BV1xx", season_id: 1, section_id: 2, season_added: false })]);
});

test("只写有变化的条目：过期快照不会覆盖别处的更新", () => {
  const db = openDb(":memory:");
  const store = createDbQueueStore(db);
  const first = store.load();
  first.items.push(item("a"), item("b"));
  store.save(first);
  const stale = store.load();
  store.patch("a", (current) => { current.status = "done"; current.bvid = "BV1aa"; });
  stale.items[1]!.title = "b2";
  store.save(stale);
  const after = store.load().items;
  assert.equal(after.find((x) => x.id === "a")?.status, "done");
  assert.equal(after.find((x) => x.id === "b")?.title, "b2");
});

test("save 收到展开出来的新对象时，也只写和库里不同的条目", () => {
  const db = openDb(":memory:");
  const store = createDbQueueStore(db);
  const first = store.load();
  first.items.push(item("a"), item("b"));
  store.save(first);
  store.patch("a", (current) => { current.status = "done"; });
  const loaded = store.load();
  const spread = { ...loaded, items: [...loaded.items, item("c")] };
  store.patch("b", (current) => { current.title = "b2"; });
  store.save(spread);
  const after = store.load().items;
  assert.equal(after.find((x) => x.id === "a")?.status, "done");
  assert.equal(after.find((x) => x.id === "b")?.title, "b2");
  assert.ok(after.find((x) => x.id === "c"));
});

test("patch 找不到返回 undefined", () => {
  assert.equal(createDbQueueStore(openDb(":memory:")).patch("nope", () => {}), undefined);
});

test("新条目没有对应曲目时建占位曲目，且满足归属约束", () => {
  const db = openDb(":memory:");
  const store = createDbQueueStore(db);
  const queue = store.load();
  queue.items.push(item("zard-BV1"));
  store.save(queue);
  const row = db.select().from(releases).where(eq(releases.id, "zard-BV1")).get();
  assert.ok(row?.trackId);
  assert.equal(db.select().from(tracks).get()?.configPath, "legacy:/out/zard-BV1.mkv");
});

test("导入旧 JSON：幂等、保留旧字段、改名原文件", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "queue-import-"));
  const file = path.join(dir, "upload-queue.json");
  const legacy = { ...item("old-1", { status: "done", bvid: "BV1ab", finished: "2026-10-26T14:04:26" }),
    config: "/prep/A/01.json", song: "歌", artist: "手", album: "辑", lyrics: "/prep/A/01.ttml", lyric_offset_ms: 120 };
  const data: QueueFile = { locked_since: null, hold_until: "2026-11-19T01:00:00+08:00",
    items: [legacy as QueueItem, item("old-2")] };
  writeFileSync(file, JSON.stringify(data));
  const db = openDb(":memory:");
  assert.deepEqual(importQueueJson(db, file), { imported: 2, skipped: 0 });
  assert.equal(existsSync(file), false);
  assert.equal(existsSync(`${file}.imported`), true);
  const real = db.select().from(tracks).where(eq(tracks.configPath, "/prep/A/01.json")).get();
  assert.equal(real?.title, "歌");
  assert.equal(real?.lyricOffsetMs, 120);
  const store = createDbQueueStore(db);
  assert.equal(store.load().hold_until, "2026-11-19T01:00:00+08:00");
  writeFileSync(file, JSON.stringify(data));
  assert.deepEqual(importQueueJson(db, file), { imported: 0, skipped: 2 });
});

test("导入失败整体回滚，原文件不动", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "queue-import-"));
  const file = path.join(dir, "upload-queue.json");
  const bad = { locked_since: null, hold_until: null, items: [item("ok"), { ...item("bad"), created: "不是时间" }] };
  writeFileSync(file, JSON.stringify(bad));
  const db = openDb(":memory:");
  assert.throws(() => importQueueJson(db, file), /无法解析时间/);
  assert.equal(existsSync(file), true);
  assert.equal(db.select().from(releases).all().length, 0);
});
```

- [ ] **Step 2: 写 `src/release/store.ts` 与 `admin/server/queue-store.ts`**

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { emptyQueue, type QueueFile, type QueueItem } from "./queue";

/** 队列的读写接口。release 命令和 runner 都经它读写，底层可以是 JSON 文件或数据库。 */
export type QueueStore = {
  load(): QueueFile;
  /** 只写入相对上次 load 有变化的条目，避免用过期快照覆盖别处的更新。 */
  save(queue: QueueFile): void;
  patch(id: string, update: (item: QueueItem) => void): QueueItem | undefined;
};

export function jsonQueueStore(file: string): QueueStore {
  const load = (): QueueFile => {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as QueueFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyQueue();
      throw error;
    }
  };
  const save = (queue: QueueFile) => writeFileSync(file, JSON.stringify(queue, null, 2) + "\n");
  return {
    load,
    save,
    patch(id, update) {
      const queue = load();
      const item = queue.items.find((entry) => entry.id === id);
      if (!item) return undefined;
      update(item);
      save(queue);
      return item;
    },
  };
}
```

```ts
import { existsSync, readFileSync, renameSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import type { QueueItem } from "../../src/release/queue";
import { batchKey, emptyQueue, type QueueFile } from "../../src/release/queue";
import type { QueueStore } from "../../src/release/store";
import type { Conn, Db } from "./db/client";
import { releases, runnerState, tracks, type ReleaseRow } from "./db/schema";
import { fromIso, toShanghaiIso } from "./time";

const ID_PATTERN = /^release-([0-9a-f]{8})-(\d{2})$/;

export function itemFromRow(row: ReleaseRow): QueueItem {
  return {
    id: row.id,
    mode: row.mode,
    status: row.status,
    video: row.video,
    title: row.title,
    created: toShanghaiIso(row.createdAt),
    ...(row.bvid ? { bvid: row.bvid } : {}),
    ...(row.seasonId != null ? { season_id: row.seasonId } : {}),
    ...(row.sectionId != null ? { section_id: row.sectionId } : {}),
    ...(row.seasonAdded != null ? { season_added: row.seasonAdded } : {}),
    ...(row.draftId ? { draft_id: row.draftId } : {}),
    ...(row.finishedAt != null ? { finished: toShanghaiIso(row.finishedAt) } : {}),
    upload: {
      title: row.uploadTitle,
      desc: row.uploadDesc,
      tag: row.uploadTag,
      cover: row.uploadCover,
      tid: row.uploadTid,
      copyright: row.uploadCopyright,
      dynamic: row.uploadDynamic,
      hires: row.uploadHires === 1 ? 1 : 0,
    },
  };
}

function valuesFromItem(item: QueueItem) {
  return {
    mode: item.mode,
    status: item.status,
    video: item.video,
    title: item.title,
    bvid: item.bvid ?? null,
    draftId: item.draft_id ?? null,
    seasonId: item.season_id ?? null,
    sectionId: item.section_id ?? null,
    seasonAdded: item.season_added ?? null,
    uploadTitle: item.upload.title,
    uploadDesc: item.upload.desc,
    uploadTag: item.upload.tag,
    uploadCover: item.upload.cover,
    uploadTid: item.upload.tid,
    uploadCopyright: item.upload.copyright,
    uploadDynamic: item.upload.dynamic ?? "",
    uploadHires: item.upload.hires,
    createdAt: fromIso(item.created),
    finishedAt: item.finished ? fromIso(item.finished) : null,
  };
}

/** 旧队列条目里 44 条带的备料字段，导入时用来建真实曲目。 */
export type LegacyExtras = {
  config?: string;
  song?: string;
  artist?: string;
  album?: string;
  lyrics?: string;
  lyric_offset_ms?: number;
};

function ensureTrackFor(conn: Conn, item: QueueItem & LegacyExtras, now: number): number {
  const found = ID_PATTERN.exec(item.id);
  if (found) {
    const hash = found[1];
    const no = Number(found[2]);
    const hit = conn.select().from(tracks).where(eq(tracks.trackNo, no)).all()
      .find((track) => batchKey(track.prepareDir) === hash);
    if (hit) return hit.id;
  }
  const configPath = item.config ?? `legacy:${item.video}`;
  conn.insert(tracks).values({
    configPath,
    prepareDir: item.config ? path.dirname(item.config) : "",
    audioPath: "",
    lyricPath: item.lyrics ?? null,
    lyricOffsetMs: item.lyric_offset_ms ?? null,
    title: item.song ?? item.title,
    artist: item.artist ?? "",
    albumTitle: item.album ?? "",
    createdAt: now,
  }).onConflictDoNothing().run();
  const row = conn.select().from(tracks).where(eq(tracks.configPath, configPath)).get();
  if (!row) throw new Error(`无法为 ${item.id} 找到或建立曲目`);
  return row.id;
}

export function createDbQueueStore(db: Db): QueueStore {
  /** 每个条目对象记着自己被读出来时的内容，save 时只写和它不同的条目。 */
  const snapshots = new WeakMap<QueueItem, string>();
  const readAll = (conn: Conn): QueueFile => {
    const state = conn.select().from(runnerState).where(eq(runnerState.id, 1)).get();
    const rows = conn.select().from(releases).all()
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const items = rows.map(itemFromRow);
    const queue: QueueFile = {
      ...emptyQueue(),
      locked_since: state?.lockedSince != null ? toShanghaiIso(state.lockedSince) : null,
      hold_until: state?.holdUntil != null ? toShanghaiIso(state.holdUntil) : null,
      items,
    };
    for (const item of items) snapshots.set(item, JSON.stringify(item));
    return queue;
  };
  const currentText = (conn: Conn, id: string): string | undefined => {
    const row = conn.select().from(releases).where(eq(releases.id, id)).get();
    return row ? JSON.stringify(itemFromRow(row)) : undefined;
  };
  const write = (conn: Conn, item: QueueItem): void => {
    const exists = conn.select({ id: releases.id }).from(releases).where(eq(releases.id, item.id)).get();
    if (exists) {
      conn.update(releases).set(valuesFromItem(item)).where(eq(releases.id, item.id)).run();
    } else {
      conn.insert(releases).values({
        id: item.id,
        trackId: ensureTrackFor(conn, item, Date.now()),
        ...valuesFromItem(item),
      }).run();
    }
  };
  return {
    load: () => readAll(db),
    save(queue) {
      db.transaction((tx) => {
        for (const item of queue.items) {
          const text = JSON.stringify(item);
          // 没有快照的是新建的条目（或展开出来的新对象），和库里当前内容比
          const seen = snapshots.get(item) ?? currentText(tx, item.id);
          if (seen === text) continue;
          write(tx, item);
          snapshots.set(item, text);
        }
      });
    },
    patch(id, update) {
      return db.transaction((tx) => {
        const row = tx.select().from(releases).where(eq(releases.id, id)).get();
        if (!row) return undefined;
        const item = itemFromRow(row);
        update(item);
        write(tx, item);
        return item;
      });
    },
  };
}

export type ImportResult = { imported: number; skipped: number };

/** 一次性把 JSON 队列导入数据库。可重复执行：已有 id 不覆盖。 */
export function importQueueJson(db: Db, file: string, now: number = Date.now()): ImportResult {
  if (!existsSync(file)) return { imported: 0, skipped: 0 };
  const data = JSON.parse(readFileSync(file, "utf8")) as QueueFile;
  const result = db.transaction((tx) => {
    let imported = 0;
    let skipped = 0;
    for (const item of data.items as (QueueItem & LegacyExtras)[]) {
      const exists = tx.select({ id: releases.id }).from(releases).where(eq(releases.id, item.id)).get();
      if (exists) { skipped += 1; continue; }
      const sameVideo = tx.select({ id: releases.id }).from(releases)
        .where(and(eq(releases.video, item.video))).get();
      if (sameVideo) { skipped += 1; continue; }
      tx.insert(releases).values({
        id: item.id,
        trackId: ensureTrackFor(tx, item, now),
        ...valuesFromItem(item),
      }).run();
      imported += 1;
    }
    const state = tx.select().from(runnerState).where(eq(runnerState.id, 1)).get();
    if (state && state.lockedSince == null && state.holdUntil == null) {
      tx.update(runnerState).set({
        lockedSince: data.locked_since ? fromIso(data.locked_since) : null,
        holdUntil: data.hold_until ? fromIso(data.hold_until) : null,
      }).where(eq(runnerState.id, 1)).run();
    }
    return { imported, skipped };
  });
  renameSync(file, `${file}.imported`);
  return result;
}
```

- [ ] **Step 3: 跑测试**

Run: `node --import ./scripts/register-ts.mjs --test admin/server/queue-store.test.ts`  
Expected: 7 个测试 pass。

- [ ] **Step 4: 对真实队列做一次导入演练（不动真文件）**

```console
cp tmp/upload-queue.json /tmp/upload-queue.rehearsal.json
RMV_DB=/tmp/rehearsal.db nub -e 'import("./admin/server/db/client").then(async ({ openDb }) => { const { importQueueJson } = await import("./admin/server/queue-store"); const db = openDb(); console.log(importQueueJson(db, "/tmp/upload-queue.rehearsal.json")); })'
```

Expected: 打印 `{ imported: N, skipped: 0 }`，N 等于 `tmp/upload-queue.json` 里的条目数；`/tmp/upload-queue.rehearsal.json` 被改名为 `.imported`；`tmp/upload-queue.json` 原文件不变。

- [ ] **Step 5: Commit**

```console
git add src/release/store.ts admin/server/queue-store.ts admin/server/queue-store.test.ts
git commit -m ":sparkles: feat(admin): 添加队列存储接口、数据库实现和旧队列一次性导入"
```

---

## Task 6: 曲库登记

**Files:**
- Create: `admin/server/library.ts`
- Test: `admin/server/library.test.ts`

**Interfaces:**
- Consumes: `src/release/order.ts` 的 `listReleaseTracks`。
- Produces: `registerPrepareDir(db, dir, deps, now?)`：目录里多于一首登记成专辑（按 `prepare_dir` upsert），只有一首登记成单曲（`album_id` 为空，不建专辑行）；按 `config_path` upsert 曲目，重复调用不会重复建行。`AudioProbe`（含 `durationSec`）、`RegisterDeps`。

- [ ] **Step 1: 写测试 `admin/server/library.test.ts`**

```ts
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openDb } from "./db/client";
import { albums, tracks } from "./db/schema";
import { registerPrepareDir, type RegisterDeps } from "./library";

const deps: RegisterDeps = {
  readTrackNumber: async (audio) => (audio.endsWith("乙.flac") ? 1 : audio.endsWith("甲.flac") ? 2 : null),
  probe: async () => ({ lossless: true, sampleRate: 96000, bitsPerSample: 24, durationSec: 200 }),
};

function prepare(names: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), "library-"));
  for (const name of names) {
    writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({
      songName: name, artistName: "许嵩", albumName: "寻雾启示",
      audioFileUrl: `${name}.flac`, lyricsFileUrl: `${name}.yrc`, coverImageUrl: "cover.jpg",
      year: 2026, genre: "Pop", match: { lyricSource: "netease", lyricFormat: "yrc" },
    }));
  }
  return dir;
}

test("多首登记为专辑：按音轨号排曲序，曲目带音频规格和歌词来源", async () => {
  const db = openDb(":memory:");
  const result = await registerPrepareDir(db, prepare(["甲", "乙"]), deps, 1);
  assert.equal(result.album?.title, "寻雾启示");
  assert.equal(result.album?.trackCount, 2);
  assert.deepEqual(result.tracks.map((t) => [t.title, t.trackNo, t.albumId === result.album?.id]),
    [["乙", 1, true], ["甲", 2, true]]);
  const first = result.tracks[0];
  assert.equal(first?.audioSampleRate, 96000);
  assert.equal(first?.audioLossless, true);
  assert.equal(first?.lyricSource, "netease");
  assert.equal(first?.lyricFormat, "yrc");
  assert.equal(first?.durationSec, 200);
});

test("只有一首登记为单曲：不建专辑，album_id 为空", async () => {
  const db = openDb(":memory:");
  const result = await registerPrepareDir(db, prepare(["丙"]), deps, 1);
  assert.equal(result.album, null);
  assert.equal(result.tracks[0]?.albumId, null);
  assert.equal(db.select().from(albums).all().length, 0);
});

test("重复登记不新增行，只更新", async () => {
  const db = openDb(":memory:");
  const dir = prepare(["甲", "乙"]);
  await registerPrepareDir(db, dir, deps, 1);
  await registerPrepareDir(db, dir, deps, 2);
  assert.equal(db.select().from(albums).all().length, 1);
  assert.equal(db.select().from(tracks).all().length, 2);
});

test("目录里没有 json 时报错", async () => {
  await assert.rejects(registerPrepareDir(openDb(":memory:"), prepare([]), deps), /没有曲目/);
});
```

- [ ] **Step 2: 写 `admin/server/library.ts`**

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { listReleaseTracks } from "../../src/release/order";
import type { Db } from "./db/client";
import { albums, tracks, type AlbumRow, type TrackRow } from "./db/schema";

export type AudioProbe = {
  lossless: boolean;
  sampleRate: number;
  bitsPerSample: number;
  durationSec: number | null;
};

export type RegisterDeps = {
  readTrackNumber: (audioPath: string) => Promise<number | null>;
  probe: (audioPath: string) => Promise<AudioProbe>;
};

type TrackJson = {
  coverImageUrl?: string;
  composer?: string;
  year?: number;
  genre?: string;
  lyricOffsetMs?: number;
  durationInSeconds?: number;
  match?: { lyricSource?: string; lyricFormat?: string };
};

/**
 * 把备料目录登记入库。多首算专辑；只有一首当单曲（album_id 为空，不建专辑行）。
 * 可重复调用：按 config_path 和 prepare_dir 更新，不会重复建行。
 */
export async function registerPrepareDir(
  db: Db,
  dir: string,
  deps: RegisterDeps,
  now: number = Date.now(),
): Promise<{ album: AlbumRow | null; tracks: TrackRow[] }> {
  const prepareDir = path.resolve(dir);
  const listed = await listReleaseTracks(prepareDir, deps.readTrackNumber);
  const first = listed[0];
  if (!first) throw new Error(`备料目录里没有曲目 json: ${prepareDir}`);
  const details = await Promise.all(listed.map(async (track) => ({
    track,
    json: JSON.parse(await readFile(track.configPath, "utf8")) as TrackJson,
    probe: await deps.probe(track.audioPath),
  })));
  const coverOf = (json: TrackJson) =>
    json.coverImageUrl ? path.join(prepareDir, json.coverImageUrl) : null;
  const firstJson = details[0]?.json;

  return db.transaction((tx) => {
    let album: AlbumRow | null = null;
    if (listed.length > 1) {
      const values = {
        title: first.albumName,
        artist: first.artistName,
        year: firstJson?.year ?? null,
        genre: firstJson?.genre ?? null,
        coverPath: firstJson ? coverOf(firstJson) : null,
        trackCount: listed.length,
      };
      tx.insert(albums).values({ prepareDir, ...values, createdAt: now })
        .onConflictDoUpdate({ target: albums.prepareDir, set: values }).run();
      album = tx.select().from(albums).where(eq(albums.prepareDir, prepareDir)).get() ?? null;
    }
    const saved: TrackRow[] = [];
    for (const { track, json, probe } of details) {
      const values = {
        albumId: album?.id ?? null,
        trackNo: track.index,
        prepareDir,
        audioPath: track.audioPath,
        lyricPath: track.lyricPath ?? null,
        coverPath: coverOf(json),
        textPath: track.textPath,
        title: track.songName,
        artist: track.artistName,
        albumTitle: track.albumName,
        composer: json.composer ?? null,
        year: json.year ?? null,
        genre: json.genre ?? null,
        durationSec: probe.durationSec ?? json.durationInSeconds ?? null,
        lyricOffsetMs: json.lyricOffsetMs ?? null,
        lyricSource: json.match?.lyricSource ?? null,
        lyricFormat: json.match?.lyricFormat ?? null,
        audioSampleRate: probe.sampleRate || null,
        audioBits: probe.bitsPerSample || null,
        audioLossless: probe.lossless,
      };
      tx.insert(tracks).values({ configPath: track.configPath, ...values, createdAt: now })
        .onConflictDoUpdate({ target: tracks.configPath, set: values }).run();
      const row = tx.select().from(tracks).where(eq(tracks.configPath, track.configPath)).get();
      if (row) saved.push(row);
    }
    return { album, tracks: saved };
  });
}
```

- [ ] **Step 3: 跑测试**

Run: `node --import ./scripts/register-ts.mjs --test admin/server/library.test.ts`  
Expected: 4 个测试 pass。

- [ ] **Step 4: Commit**

```console
git add admin/server/library.ts admin/server/library.test.ts
git commit -m ":sparkles: feat(admin): 添加备料目录登记，区分专辑和单曲"
```

---

## Task 7: 子进程工具（移到 `src/lib`）

**Files:**
- Create: `src/lib/process.ts`
- Test: `src/lib/process.test.ts`

**Interfaces:**
- Produces: `streamCommand(command, { cwd?, env?, signal?, onLine? }) → { exitCode, output, aborted }`（按 `\r`、`\n` 切行；中止时先 SIGTERM，5 秒后 SIGKILL；不使用 `detached`）、`abortableSleep(ms, signal?)`（中止时 reject `已取消`）。
- 放在 `src/lib` 是因为 `src/export/render.ts` 也要用，`src` 不能反向依赖 `admin`。

- [ ] **Step 1: 写测试 `src/lib/process.test.ts`**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { abortableSleep, streamCommand } from "./process";

test("streamCommand 按 \\n 和 \\r 切行，返回退出码", async () => {
  const lines: string[] = [];
  const result = await streamCommand(["sh", "-c", "printf 'a\\rb\\nc'; echo err >&2; exit 3"], {
    onLine: (line, stream) => lines.push(`${stream}:${line}`),
  });
  assert.equal(result.exitCode, 3);
  assert.deepEqual(lines.sort(), ["stderr:err", "stdout:a", "stdout:b", "stdout:c"]);
});

test("中止信号会结束子进程", async () => {
  const controller = new AbortController();
  const started = Date.now();
  const running = streamCommand(["sleep", "30"], { signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  const result = await running;
  assert.equal(result.aborted, true);
  assert.ok(Date.now() - started < 3000);
});

test("可取消的等待", async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(abortableSleep(5000, controller.signal), /已取消/);
});
```

- [ ] **Step 2: 写 `src/lib/process.ts`**

```ts
import { spawn } from "node:child_process";

export type StreamOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  /** 每一行（按 \n 或 \r 切）。 */
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
};

export type StreamResult = { exitCode: number; output: string; aborted: boolean };

/** 运行子进程并逐行回调。不使用 detached：终端关闭时子进程跟着退出。 */
export function streamCommand(command: string[], options: StreamOptions = {}): Promise<StreamResult> {
  return new Promise((resolve, reject) => {
    const [bin, ...args] = command;
    if (!bin) { reject(new Error("命令为空")); return; }
    const child = spawn(bin, args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let aborted = false;
    const tails = { stdout: "", stderr: "" };
    const feed = (stream: "stdout" | "stderr", chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      const pieces = (tails[stream] + text).split(/[\r\n]+/);
      tails[stream] = pieces.pop() ?? "";
      for (const line of pieces) if (line) options.onLine?.(line, stream);
    };
    child.stdout.on("data", (chunk: Buffer) => feed("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => feed("stderr", chunk));
    let killer: NodeJS.Timeout | undefined;
    const onAbort = () => {
      aborted = true;
      child.kill("SIGTERM");
      killer = setTimeout(() => child.kill("SIGKILL"), 5000);
    };
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", reject);
    child.on("close", (code) => {
      if (killer) clearTimeout(killer);
      options.signal?.removeEventListener("abort", onAbort);
      for (const stream of ["stdout", "stderr"] as const) {
        if (tails[stream]) options.onLine?.(tails[stream], stream);
      }
      resolve({ exitCode: code ?? 1, output, aborted });
    });
  });
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("已取消")); return; }
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(new Error("已取消")); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
```

- [ ] **Step 3: 跑测试**

Run: `node --import ./scripts/register-ts.mjs --test src/lib/process.test.ts`  
Expected: 3 个测试 pass。

- [ ] **Step 4: Commit**

```console
git add src/lib/process.ts src/lib/process.test.ts
git commit -m ":sparkles: feat(lib): 添加可取消、逐行回调的子进程工具"
```

---

## Task 8: Runner 核心

**Files:**
- Create: `admin/server/runner/{types,progress,idle,lock,index}.ts`
- Test: `admin/server/runner/{runner,idle,support}.test.ts`

**Interfaces:**
- Consumes: Task 3、4、7。
- Produces:
  - `JobContext { db, settings, signal, log(line, stream?), progress(0..1) }`、`Executor`、`Executors`（`Record<JobKind, Executor>`）。
  - `createRunner({ db, executors, now?, pollMs?, onTick? }) → { tick, start, whenIdle, stop }`：每个 lane 的并行数从 `settings` 读（热更新）；日志缓冲每 500ms 落库；`cancel_requested` 每个 tick 轮询并 abort；`stop()` 把在跑的任务标成 `interrupted`。
  - `decideIdle`、`parseScreenLocked`（空闲判定，纯函数）。
  - `acquireRunnerLock`、`beat`、`releaseRunnerLock`、`runnerOnline`（单 runner 实例，心跳 5 秒，15 秒视为过期）。
  - `parseRenderProgress`、`isProgressLine`（Remotion 输出进度：Bundling→0–0.05，Rendered N/T→0.05+0.85·N/T，Encoded→null）。

- [ ] **Step 1: 写测试**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { openDb } from "../db/client";
import { JOB_KINDS } from "../db/schema";
import { enqueueJob, getJob, listLogs, requestCancel } from "../jobs";
import { updateSettings } from "../settings";
import { createRunner } from "./index";
import type { Executor, Executors } from "./types";

const gate = () => {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => { open = resolve; });
  return { promise, open };
};
const executors = (overrides: Partial<Executors>): Executors =>
  Object.fromEntries(JOB_KINDS.map((kind) => [kind, overrides[kind] ?? (async () => undefined)])) as Executors;
const waitAbort: Executor = (_job, ctx) => new Promise((_, reject) => {
  ctx.signal.addEventListener("abort", () => reject(new Error("aborted")));
});

test("两条 lane 同一次 tick 里各启动一个任务", async () => {
  const db = openDb(":memory:");
  const g = gate();
  const started: string[] = [];
  const runner = createRunner({ db, executors: executors({
    export: async () => { started.push("export"); await g.promise; },
    upload: async () => { started.push("upload"); await g.promise; },
  }) });
  enqueueJob(db, { kind: "export" });
  enqueueJob(db, { kind: "export" });
  enqueueJob(db, { kind: "upload" });
  await runner.tick();
  assert.deepEqual(started.sort(), ["export", "upload"]);
  g.open();
  await runner.whenIdle();
});

test("并行数读设置：render 调到 2 后同时跑两个", async () => {
  const db = openDb(":memory:");
  updateSettings(db, { "render.maxParallel": 2 });
  const g = gate();
  let live = 0;
  let peak = 0;
  const runner = createRunner({ db, executors: executors({
    export: async () => { live += 1; peak = Math.max(peak, live); await g.promise; live -= 1; },
  }) });
  for (let i = 0; i < 3; i += 1) enqueueJob(db, { kind: "export" });
  await runner.tick();
  assert.equal(peak, 2);
  g.open();
  await runner.whenIdle();
  await runner.tick();
  await runner.whenIdle();
  assert.equal(getJob(db, 3)?.status, "succeeded");
});

test("成功写结果和日志，失败级联取消依赖", async () => {
  const db = openDb(":memory:");
  const runner = createRunner({ db, executors: executors({
    export: async (_job, ctx) => { ctx.log("渲染中"); throw new Error("渲染崩了"); },
  }) });
  const a = enqueueJob(db, { kind: "export" });
  const b = enqueueJob(db, { kind: "cover", dependsOn: [a.id] });
  await runner.tick();
  await runner.whenIdle();
  assert.equal(getJob(db, a.id)?.status, "failed");
  assert.equal(getJob(db, a.id)?.error, "渲染崩了");
  assert.equal(getJob(db, b.id)?.status, "cancelled");
  assert.deepEqual(listLogs(db, a.id, 0).map((row) => row.line), ["渲染中", "任务失败: 渲染崩了"]);
});

test("取消：运行中的任务在下一次 tick 被中止", async () => {
  const db = openDb(":memory:");
  const runner = createRunner({ db, executors: executors({ export: waitAbort }) });
  const a = enqueueJob(db, { kind: "export" });
  await runner.tick();
  assert.equal(requestCancel(db, a.id, 1), "requested");
  await runner.tick();
  await runner.whenIdle();
  assert.equal(getJob(db, a.id)?.status, "cancelled");
});

test("stop：在跑的任务标成 interrupted", async () => {
  const db = openDb(":memory:");
  const runner = createRunner({ db, executors: executors({ export: waitAbort }) });
  const a = enqueueJob(db, { kind: "export" });
  await runner.tick();
  await runner.stop();
  assert.equal(getJob(db, a.id)?.status, "interrupted");
});
```

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { decideIdle, parseScreenLocked, type IdleInput } from "./idle";

const at = (hour: number, minute = 0) => new Date(2026, 10, 21, hour, minute).getTime();
const base = (patch: Partial<IdleInput>): IdleInput => ({
  now: at(14), enabled: true, holdUntil: null, nightStartHour: 0, nightEndHour: 6,
  lockMinutes: 10, locked: false, lockedSince: null, ...patch,
});

test("夜间窗口直接空闲", () => {
  assert.equal(decideIdle(base({ now: at(3) })).idle, true);
  assert.equal(decideIdle(base({ now: at(6) })).idle, false);
});

test("锁屏：第一次只记时间，满时长后才空闲，解锁清零", () => {
  const first = decideIdle(base({ locked: true }));
  assert.deepEqual([first.idle, first.lockedSince], [false, at(14)]);
  assert.equal(decideIdle(base({ now: at(14, 9), locked: true, lockedSince: at(14) })).idle, false);
  assert.equal(decideIdle(base({ now: at(14, 10), locked: true, lockedSince: at(14) })).idle, true);
  assert.equal(decideIdle(base({ locked: false, lockedSince: at(14) })).lockedSince, null);
});

test("开关和 hold_until 优先", () => {
  assert.equal(decideIdle(base({ now: at(3), enabled: false })).idle, false);
  assert.equal(decideIdle(base({ now: at(3), holdUntil: at(5) })).idle, false);
  assert.equal(decideIdle(base({ now: at(5, 30), holdUntil: at(5) })).idle, true);
});

test("解析 ioreg 输出", () => {
  assert.equal(parseScreenLocked('  | "CGSSessionScreenIsLocked" = Yes\n'), true);
  assert.equal(parseScreenLocked('  | "IOConsoleUsers" = ()'), false);
});
```

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { openDb } from "../db/client";
import { acquireRunnerLock, releaseRunnerLock, runnerOnline } from "./lock";
import { isProgressLine, parseRenderProgress } from "./progress";

test("解析 remotion 的三种输出", () => {
  assert.equal(parseRenderProgress("Bundling 100%"), 0.05);
  assert.equal(parseRenderProgress("Rendered 0/8056"), 0.05);
  assert.equal(parseRenderProgress("Rendered 4028/8056, time remaining: 1m"), 0.475);
  assert.equal(parseRenderProgress("Rendered 8056/8056"), 0.9);
  assert.equal(parseRenderProgress("Encoded 88/8056"), null);
  assert.equal(parseRenderProgress("正在渲染无声画面"), null);
  assert.equal(isProgressLine("Encoded 88/8056"), true);
  assert.equal(isProgressLine("Composition  AMLLPlayer"), false);
});

test("runner 单实例锁：同一进程可重入，别的活进程占用时拒绝，过期可接管", () => {
  const db = openDb(":memory:");
  assert.equal(acquireRunnerLock(db, process.pid, 1000), true);
  assert.equal(acquireRunnerLock(db, process.pid, 2000), true);
  assert.equal(acquireRunnerLock(db, 999_999, 3000), false);
  assert.equal(acquireRunnerLock(db, 999_999, 3000 + 20_000), true);
  releaseRunnerLock(db, 999_999);
  assert.equal(runnerOnline(null, 1), false);
  assert.equal(runnerOnline(1000, 5000), true);
});
```

- [ ] **Step 2: 写实现**

```ts
import type { Db } from "../db/client";
import type { JobKind, JobRow } from "../db/schema";
import type { Settings } from "../settings";

export type LogStream = "stdout" | "stderr" | "system";

export type JobContext = {
  db: Db;
  settings: Settings;
  /** 用户取消或 runner 退出时中止。执行器要把它传给子进程和等待。 */
  signal: AbortSignal;
  log(line: string, stream?: LogStream): void;
  progress(value: number): void;
};

export type Executor = (job: JobRow, ctx: JobContext) => Promise<unknown>;
export type Executors = Record<JobKind, Executor>;
```

```ts
/**
 * 把 remotion render 的输出行换成 0 到 1 的整体进度，认不出的行返回 null。
 * 真实输出有三种：`Bundling 8%`、`Rendered 120/8056, time remaining: …`、`Encoded 88/8056`。
 * 打包占前 5%，渲染占 5% 到 90%；Encoded 跟在渲染后面，不单独计算。
 */
export function parseRenderProgress(line: string): number | null {
  const bundling = /^Bundling (\d+)%/.exec(line);
  if (bundling) return (Number(bundling[1]) / 100) * 0.05;
  const rendered = /^Rendered (\d+)\/(\d+)/.exec(line);
  if (rendered) {
    const total = Number(rendered[2]);
    if (total <= 0) return null;
    return 0.05 + 0.85 * Math.min(1, Number(rendered[1]) / total);
  }
  return null;
}

/** 进度行每帧一条，不逐行写日志。 */
export function isProgressLine(line: string): boolean {
  return /^(Bundling \d+%|Rendered \d+\/\d+|Encoded \d+\/\d+)/.test(line);
}
```

```ts
export type IdleInput = {
  now: number;
  enabled: boolean;
  holdUntil: number | null;
  nightStartHour: number;
  nightEndHour: number;
  lockMinutes: number;
  locked: boolean;
  lockedSince: number | null;
};

export type IdleDecision = {
  idle: boolean;
  /** 要写回 runner_state 的 locked_since。 */
  lockedSince: number | null;
  reason: string;
};

export function decideIdle(input: IdleInput): IdleDecision {
  const lockedSince = !input.locked ? null : (input.lockedSince ?? input.now);
  if (!input.enabled) return { idle: false, lockedSince, reason: "空闲调度已关闭" };
  if (input.holdUntil != null && input.now < input.holdUntil) {
    return { idle: false, lockedSince, reason: "还在 hold_until 之前" };
  }
  const hour = new Date(input.now).getHours();
  if (hour >= input.nightStartHour && hour < input.nightEndHour) {
    return { idle: true, lockedSince, reason: "夜间窗口" };
  }
  if (!input.locked) return { idle: false, lockedSince, reason: "屏幕未锁定，不在夜间窗口" };
  if (input.lockedSince == null) return { idle: false, lockedSince, reason: "刚发现锁屏，先记下时间" };
  const lockedMs = input.now - input.lockedSince;
  if (lockedMs >= input.lockMinutes * 60_000) return { idle: true, lockedSince, reason: "锁屏已满时长" };
  return { idle: false, lockedSince, reason: "锁屏还没满时长" };
}

export function parseScreenLocked(ioregOutput: string): boolean {
  return /"CGSSessionScreenIsLocked"\s*=\s*Yes/.test(ioregOutput);
}
```

```ts
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { runnerState } from "../db/schema";

export const HEARTBEAT_MS = 5000;
const STALE_MS = 15_000;

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** 已有活着的 runner（心跳新鲜且进程存在）时返回 false。 */
export function acquireRunnerLock(db: Db, pid: number, now: number): boolean {
  return db.transaction((tx) => {
    const state = tx.select().from(runnerState).where(eq(runnerState.id, 1)).get();
    const other = state?.pid != null && state.pid !== pid
      && state.heartbeatAt != null && now - state.heartbeatAt < STALE_MS && alive(state.pid);
    if (other) return false;
    tx.update(runnerState).set({ pid, heartbeatAt: now }).where(eq(runnerState.id, 1)).run();
    return true;
  });
}

export function beat(db: Db, pid: number, now: number): void {
  db.update(runnerState).set({ pid, heartbeatAt: now }).where(eq(runnerState.id, 1)).run();
}

export function releaseRunnerLock(db: Db, pid: number): void {
  const state = db.select().from(runnerState).where(eq(runnerState.id, 1)).get();
  if (state?.pid === pid) db.update(runnerState).set({ pid: null, heartbeatAt: null }).where(eq(runnerState.id, 1)).run();
}

export function runnerOnline(heartbeatAt: number | null, now: number): boolean {
  return heartbeatAt != null && now - heartbeatAt < STALE_MS;
}
```

```ts
import type { Db } from "../db/client";
import { LANES, type JobRow } from "../db/schema";
import {
  appendLogs, cancelRequestedIds, claimNext, countRunning, finishJob, setProgress,
  type LogEntry,
} from "../jobs";
import { getSettings, type Settings } from "../settings";
import type { Executors, JobContext, LogStream } from "./types";

export type RunnerOptions = {
  db: Db;
  executors: Executors;
  now?: () => number;
  pollMs?: number;
  /** 每次 tick 之后调用，空闲调度挂在这里。 */
  onTick?: (settings: Settings) => void | Promise<void>;
};

export type Runner = {
  tick(): Promise<void>;
  start(): void;
  /** 等所有正在跑的任务结束。 */
  whenIdle(): Promise<void>;
  /** 停止领取，中止在跑的任务（标成 interrupted），等它们收尾。 */
  stop(): Promise<void>;
};

type Running = { controller: AbortController; done: Promise<void> };

export function createRunner(options: RunnerOptions): Runner {
  const { db, executors } = options;
  const now = options.now ?? Date.now;
  const running = new Map<number, Running>();
  let stopping = false;
  let timer: NodeJS.Timeout | undefined;

  async function execute(job: JobRow, settings: Settings, controller: AbortController) {
    let buffer: LogEntry[] = [];
    const flush = () => {
      if (buffer.length === 0) return;
      const batch = buffer;
      buffer = [];
      appendLogs(db, job.id, batch, now(), settings["log.maxLinesPerJob"]);
    };
    const flushTimer = setInterval(flush, 500);
    const ctx: JobContext = {
      db,
      settings,
      signal: controller.signal,
      log: (line: string, stream: LogStream = "system") => { buffer.push({ stream, line }); },
      progress: (value: number) => setProgress(db, job.id, value, now()),
    };
    try {
      const result = await executors[job.kind](job, ctx);
      clearInterval(flushTimer);
      flush();
      finishJob(db, job.id, { status: "succeeded", result }, now());
    } catch (error) {
      clearInterval(flushTimer);
      if (controller.signal.aborted) {
        flush();
        finishJob(db, job.id, stopping ? { status: "interrupted" } : { status: "cancelled" }, now());
      } else {
        const message = error instanceof Error ? error.message : String(error);
        buffer.push({ stream: "system", line: `任务失败: ${message}` });
        flush();
        finishJob(db, job.id, { status: "failed", error: message }, now());
      }
    } finally {
      running.delete(job.id);
    }
  }

  function begin(job: JobRow, settings: Settings) {
    const controller = new AbortController();
    const entry: Running = { controller, done: Promise.resolve() };
    running.set(job.id, entry);
    entry.done = execute(job, settings, controller);
  }

  const runner: Runner = {
    async tick() {
      if (stopping) return;
      const settings = getSettings(db);
      for (const id of cancelRequestedIds(db)) running.get(id)?.controller.abort();
      for (const lane of LANES) {
        const max = lane === "render" ? settings["render.maxParallel"] : settings["bili.maxParallel"];
        while (countRunning(db, lane) < max) {
          const job = claimNext(db, lane, now());
          if (!job) break;
          begin(job, settings);
        }
      }
      await options.onTick?.(settings);
    },
    start() {
      timer = setInterval(() => { void runner.tick(); }, options.pollMs ?? 1000);
      void runner.tick();
    },
    async whenIdle() {
      while (running.size > 0) await Promise.all([...running.values()].map((entry) => entry.done));
    },
    async stop() {
      stopping = true;
      if (timer) clearInterval(timer);
      for (const entry of running.values()) entry.controller.abort();
      await runner.whenIdle();
    },
  };
  return runner;
}
```

- [ ] **Step 3: 跑测试**

Run: `node --import ./scripts/register-ts.mjs --test admin/server/runner/*.test.ts`  
Expected: 11 个测试 pass（runner 5、idle 4、support 2）。

- [ ] **Step 4: 全量类型检查**

Run: `nub exec tsc -p admin`  
Expected: 无输出。

- [ ] **Step 5: Commit**

```console
git add admin/server/runner
git commit -m ":sparkles: feat(admin): 添加按 lane 并行、可取消的 runner 与空闲判定"
```

---

## Task 9: 导出链路支持日志回调与取消

**Files:**
- Modify: `src/export/render.ts`

**Interfaces:**
- Consumes: Task 7 的 `streamCommand`。
- Produces: `export type ExportRuntime = { onLog?(line, stream); signal?: AbortSignal }`；`exportVideo(args, runtime?)`。不传 `runtime` 时行为与现在完全一致（`stdio: "inherit"`）；传了就用管道逐行回调，并在各阶段之间检查取消。只改单曲导出路径，专辑静帧路径（`renderAlbumCueVideo`）和 `previewStudio` 保持原样。

- [ ] **Step 1: 导入与类型**

在 `src/export/render.ts` 顶部导入区追加：

```ts
import { streamCommand } from "../lib/process";
```

在 `remotionBin()` 之后、`runRemotion` 之前追加：

```ts
export type ExportRuntime = {
  /** 每一行输出（Remotion 的进度行、本文件自己的提示行）。 */
  onLog?: (line: string, stream: "stdout" | "stderr") => void;
  /** 取消信号：中止后结束 Remotion 子进程并抛出「已取消」。 */
  signal?: AbortSignal;
};
```

- [ ] **Step 2: 改 `runRemotion`**

把整个 `runRemotion` 换成：

```ts
function runRemotion(args: string[], tmpDir: string, runtime?: ExportRuntime): Promise<void> {
  if (runtime?.onLog || runtime?.signal) {
    return streamCommand([remotionBin(), ...args], {
      cwd: projectRoot(),
      env: withProjectTmpEnv(tmpDir),
      signal: runtime.signal,
      onLine: runtime.onLog,
    }).then((result) => {
      if (result.aborted) throw new Error("已取消");
      if (result.exitCode !== 0) throw new Error(`Remotion 退出码 ${result.exitCode}`);
    });
  }
  return new Promise((resolve, reject) => {
    const child = spawn(remotionBin(), args, {
      stdio: "inherit",
      cwd: projectRoot(),
      env: withProjectTmpEnv(tmpDir),
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0 || code === null) {
        resolve();
        return;
      }
      reject(new Error(`Remotion 退出码 ${code}`));
    });
  });
}
```

- [ ] **Step 3: 改 `exportVideo`**

签名改成 `export async function exportVideo(args: ExportArgs, runtime?: ExportRuntime): Promise<string>`，并在函数开头（`await stopRemotionStudioBeforeExport();` 之前）加：

```ts
  const log = (line: string) => {
    if (runtime?.onLog) runtime.onLog(line, "stdout");
    else console.log(line);
  };
```

函数体里的 4 处 `console.log(...)`（「正在渲染无声画面」「正在拼接原音轨…」「正在合成…」两处三元的那条）统一换成 `log(...)`，参数不变。`runRemotion(...)` 调用（单曲路径那一处）补第三个参数 `runtime`：

```ts
      await runRemotion(
        remotionCommonArgs({
          job,
          args,
          outputPath: silentVideoPath,
          compositionId,
          propsPath,
        }),
        tmpDir,
        runtime,
      );
```

在 `await runRemotion(...)` 之后、`let audio = job.sourceAudios[0];` 之前，以及 `await muxOriginalAudio(...)` 之前，各加一行：

```ts
    runtime?.signal?.throwIfAborted();
```

`renderAlbumCueVideo` 和 `writeAlbumChapterSidecar` 里的 `console.log` 不动。

- [ ] **Step 4: 类型检查与行为回归**

Run: `nub exec tsc`  
Expected: 无输出。

Run: `nub run export -- --help`  
Expected: 打印用法，退出码 0（不传 `runtime` 的路径没有被破坏）。

- [ ] **Step 5: Commit**

```console
git add src/export/render.ts
git commit -m ":sparkles: feat(export): 导出支持逐行日志回调和取消信号"
```

---

## Task 10: 抽出投稿逻辑，`release` CLI 改走数据库

**Files:**
- Create: `src/release/ops.ts`, `admin/server/boot.ts`
- Modify: `src/release/cli.ts`, `src/release/export-batch.ts`, `src/release/upload-one.ts`, `src/release/io.ts`
- Test: `src/release/ops.test.ts`, `src/release/export-batch.test.ts`, `src/release/upload-one.test.ts`

**Interfaces:**
- Consumes: Task 5 的 `QueueStore`、`createDbQueueStore`、`importQueueJson`；Task 6 的 `registerPrepareDir`。
- Produces:
  - `export-batch.ts`：`outDirFor(prepareDir, cwd?)`、`videoPathFor(outDir, artistName, songName)`。
  - `io.probeAudio` 多返回 `durationSec`。
  - `upload-one.ts`：`UploadDeps` 多两个可选项 `bin`（默认 `biliup`）、`retryWaitMs`（默认 `UPLOAD_GAP_MS`）。
  - `ops.ts`：`ReleaseRuntime`、`ReleaseTiming`、`DEFAULT_TIMING`、`defaultRuntime(store)`、`writeCover`、`stampSeason`、`addToSeason`、`saveDraft`、`assertNoOtherUpload`、`uploadById`、`nextLocalMidnight`。
  - `boot.ts`：`bootDb(file?)` = 打开数据库 + 一次性导入 `tmp/upload-queue.json`。
- 行为约束：CLI 的行为不变，只是队列读写落到数据库；覆盖稿遇到限流不存草稿（AGENTS.md 要求），遇到 `137022` 通过 `onHold` 回调写 `hold_until`。

- [ ] **Step 1: 测试 — `export-batch.test.ts` 追加**

```ts
import { outDirFor, videoPathFor } from "./export-batch";

test("成片路径由备料目录名和歌手-歌名决定", () => {
  assert.equal(outDirFor("/x/预处理/寻雾", "/proj"), "/proj/out/寻雾");
  assert.equal(videoPathFor("/proj/out/寻雾", "许嵩", "叹服"), "/proj/out/寻雾/许嵩-叹服.mkv");
});
```

（把 `import { outDirFor, videoPathFor } from "./export-batch";` 合并进文件头已有的 `import { exportAndEnqueue } from "./export-batch";`。）

- [ ] **Step 2: 测试 — `upload-one.test.ts` 追加**

```ts
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
```

- [ ] **Step 3: 测试 — 新建 `src/release/ops.test.ts`**

```ts
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
```

- [ ] **Step 4: 跑测试，确认失败**

Run: `node --import ./scripts/register-ts.mjs --test src/release/ops.test.ts src/release/upload-one.test.ts src/release/export-batch.test.ts`  
Expected: FAIL（找不到 `./ops`，`bin`/`outDirFor` 不存在）。

- [ ] **Step 5: 改 `export-batch.ts`**

在文件末尾追加，并让 `exportAndEnqueue` 里的 `const video = path.join(...)` 改用 `videoPathFor`：

```ts
export function outDirFor(prepareDir: string, cwd: string = process.cwd()): string {
  return path.join(cwd, "out", path.basename(prepareDir));
}

export function videoPathFor(outDir: string, artistName: string, songName: string): string {
  return path.join(outDir, `${artistName}-${songName}.mkv`);
}
```

```ts
    const video = videoPathFor(options.outDir, track.artistName, track.songName);
```

- [ ] **Step 6: 改 `upload-one.ts`**

`UploadDeps` 增加两个可选字段：

```ts
export type UploadDeps = {
  cookie: string;
  /** biliup 可执行文件，默认 "biliup"。 */
  bin?: string;
  /** 21566 之后等多久再试同一条，默认 UPLOAD_GAP_MS。 */
  retryWaitMs?: number;
  run: (command: string[]) => Promise<{ exitCode: number; output: string }>;
  sleep: (ms: number) => Promise<void>;
  saveDraft: (item: QueueItem, output: string) => Promise<string>;
};
```

`uploadItem` 里两处：

```ts
    const result = await deps.run(commandFor(item, deps.cookie, deps.bin ?? "biliup"));
```

```ts
      await deps.sleep(deps.retryWaitMs ?? UPLOAD_GAP_MS);
```

`commandFor` 签名改为 `commandFor(item: QueueItem, cookie: string, bin: string)`，里面两处字面量 `"biliup"` 换成 `bin`。保留工作区里已有的 `failUpload`。

- [ ] **Step 7: 改 `io.ts` 的 `probeAudio`**

```ts
  return {
    lossless,
    sampleRate: metadata.format.sampleRate ?? 0,
    bitsPerSample: metadata.format.bitsPerSample ?? 0,
    durationSec: metadata.format.duration ?? null,
  };
```

- [ ] **Step 8: 写 `src/release/ops.ts`**

```ts
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  biliCall,
  cookiePath,
  listSeasons,
  readCookies,
  runCommand,
  sleep,
  trimNewPart,
} from "./io";
import type { ReleaseTrack } from "./order";
import { batchKey, releaseItemId, type QueueItem } from "./queue";
import { classifySeasonAdd, ensureSeason } from "./season";
import type { QueueStore } from "./store";
import { uploadItem } from "./upload-one";

export type RunResult = { exitCode: number; output: string };

export type ReleaseTiming = {
  /** 21566 之后等多久再试同一条。 */
  rateLimitWaitMs: number;
  /** 合集、草稿的写操作之间至少隔多久。 */
  writeIntervalMs: number;
  /** 新稿件加合集返回 -404 / 「啥都木有」之后等多久。 */
  notFoundWaitMs: number;
  /** 20111 / 256000「编辑过于频繁」之后等多久。 */
  editBusyWaitMs: number;
  /** 投稿成功后，第一次加合集前等多久。 */
  addDelayMs: number;
  /** 草稿箱容量。 */
  draftCapacity: number;
};

/** CLI 用的默认值，与重构前的行为一致。runner 用设置表里的值。 */
export const DEFAULT_TIMING: ReleaseTiming = {
  rateLimitWaitMs: 180_000,
  writeIntervalMs: 4000,
  notFoundWaitMs: 30_000,
  editBusyWaitMs: 30_000,
  addDelayMs: 4000,
  draftCapacity: 30,
};

export type ReleaseRuntime = {
  store: QueueStore;
  log: (line: string) => void;
  /** runner 里是可取消的等待。 */
  sleep: (ms: number) => Promise<void>;
  run: (command: string[]) => Promise<RunResult>;
  timing: ReleaseTiming;
  biliup: string;
  ffmpeg: string;
  /** 覆盖稿遇到 137022 时调用，参数是次日 00:00。runner 把它写进 runner_state.hold_until。 */
  onHold?: (until: number) => void;
};

export function defaultRuntime(store: QueueStore): ReleaseRuntime {
  return {
    store,
    log: (line) => console.log(line),
    sleep,
    run: runCommand,
    timing: DEFAULT_TIMING,
    biliup: "biliup",
    ffmpeg: "ffmpeg",
  };
}

export function nextLocalMidnight(now: number): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime();
}

/** 20111、256000：编辑过于频繁。等一会儿重试刚才这一次，不接着发下一条。 */
async function biliWrite(
  rt: ReleaseRuntime,
  send: () => ReturnType<typeof biliCall>,
): Promise<Awaited<ReturnType<typeof biliCall>>> {
  for (let attempt = 0; ; attempt += 1) {
    const body = await send();
    const busy = body.code === 20111 || body.code === 256000;
    if (!busy || attempt >= 5) return body;
    rt.log(`合集编辑过于频繁（${body.code}），${Math.round(rt.timing.editBusyWaitMs / 1000)} 秒后重试同一次`);
    await rt.sleep(rt.timing.editBusyWaitMs);
  }
}

export async function stampSeason(
  rt: ReleaseRuntime,
  prepareDir: string,
  tracks: ReleaseTrack[],
): Promise<{ seasonId: number; sectionId: number }> {
  const first = tracks[0];
  if (!first) throw new Error(`目录里没有曲目 ${prepareDir}`);
  const cover = ["cover.jpg", "Cover.jpg"].map((name) => path.join(prepareDir, name))
    .find((file) => existsSync(file));
  if (!cover) throw new Error(`备料目录没有专辑封面 ${prepareDir}`);
  const jpeg = path.join(process.cwd(), "tmp", `release-season-${batchKey(prepareDir)}.jpg`);
  const converted = await rt.run([
    rt.ffmpeg, "-y", "-i", cover, "-frames:v", "1", "-q:v", "3", jpeg,
  ]);
  if (converted.exitCode !== 0) throw new Error("封面转 JPEG 失败");
  const form = "application/x-www-form-urlencoded";
  const season = await ensureSeason({
    title: `${first.artistName} ${first.albumName}`,
    sectionTitle: first.albumName,
    desc: `${first.artistName}专辑《${first.albumName}》的歌词视频。`,
    coverPath: jpeg,
    client: {
      list: listSeasons,
      uploadCover: async (file) => {
        const { csrf } = await readCookies();
        const bytes = await readFile(file);
        const body = await biliWrite(rt, () => biliCall(
          "POST",
          "https://member.bilibili.com/x/vu/web/cover/up",
          new URLSearchParams({
            cover: `data:image/jpeg;base64,${bytes.toString("base64")}`,
            csrf,
          }).toString(),
          form,
        ));
        if (body.code !== 0) throw new Error(`封面上传失败 ${body.code} ${body.message ?? ""}`);
        return String((body.data as { url?: string }).url ?? "");
      },
      create: async (fields) => {
        const { csrf } = await readCookies();
        const body = await biliWrite(rt, () => biliCall(
          "POST",
          "https://member.bilibili.com/x2/creative/web/season/add",
          new URLSearchParams({ ...fields, season_price: "0", csrf }).toString(),
          form,
        ));
        if (body.code !== 0) throw new Error(body.message ?? "创建合集失败");
        return Number(body.data);
      },
      switchGroup: async (seasonId) => {
        const { csrf } = await readCookies();
        const body = await biliWrite(rt, () => biliCall(
          "POST",
          "https://member.bilibili.com/x2/creative/web/season/section/switch",
          new URLSearchParams({
            csrf, season_id: String(seasonId), no_section: "0",
          }).toString(),
          form,
        ));
        // 20081：已存在正片分组，不是限流，也不是失败。
        if (body.code !== 0 && body.code !== 20081) {
          throw new Error(body.message ?? "打开合集分组失败");
        }
      },
      renameSection: async (seasonId, sectionId, title) => {
        const { csrf } = await readCookies();
        const body = await biliWrite(rt, () => biliCall(
          "POST",
          `https://member.bilibili.com/x2/creative/web/season/section/edit?csrf=${csrf}`,
          JSON.stringify({
            section: { id: sectionId, type: 1, seasonId, title },
            sorts: [],
          }),
          "application/json",
        ));
        if (body.code !== 0) throw new Error(body.message ?? "重命名小节失败");
      },
      pause: () => rt.sleep(rt.timing.writeIntervalMs),
    },
  });
  for (const track of tracks) {
    rt.store.patch(releaseItemId(prepareDir, track.index), (item) => {
      item.season_id = season.seasonId;
      item.section_id = season.sectionId;
    });
  }
  rt.log(`合集 ${season.seasonId} 小节 ${season.sectionId}`);
  return season;
}

export async function writeCover(
  rt: ReleaseRuntime,
  track: ReleaseTrack,
  video: string,
  cover: string,
): Promise<void> {
  let seconds = "2";
  if (track.lyricPath && existsSync(track.lyricPath)) {
    const timed = await rt.run([
      "nub", "tmp/lyric-cover-time.ts", track.lyricPath, track.songName, track.artistName,
    ]);
    const line = timed.output.trim().split("\n").at(-1);
    if (timed.exitCode === 0 && line && Number.isFinite(Number(line))) seconds = line;
  }
  const shot = await rt.run([
    rt.ffmpeg, "-y", "-ss", seconds, "-i", video,
    "-frames:v", "1", "-update", "1", "-q:v", "2", cover,
  ]);
  if (shot.exitCode !== 0 || !existsSync(cover)) throw new Error(`抽封面失败 ${track.songName}`);
}

const ANY_UPLOAD = "biliup upload|biliup append|src/release/cli.ts";

/** pattern 默认拦住别的 biliup 投稿和别的 release CLI。runner 自己会起 biliup 子进程，只拦 CLI。 */
export async function assertNoOtherUpload(
  rt: ReleaseRuntime,
  pattern: string = ANY_UPLOAD,
): Promise<void> {
  const found = await rt.run(["pgrep", "-fl", pattern]);
  const others = found.output.split("\n").map((line) => line.trim()).filter((line) => {
    const pid = Number(line.split(" ", 1)[0]);
    return line && pid !== process.pid && !line.includes("pgrep");
  });
  if (others.length > 0) throw new Error("已有投稿在进行");
}

function fieldFrom(output: string, name: "filename" | "cid"): string | null {
  const patterns = name === "filename"
    ? [/"filename"\s*:\s*"([^"]+)"/, /filename:\s*String\("([^"]+)"\)/]
    : [/"cid"\s*:\s*(\d+)/, /cid:\s*Number\((\d+)\)/];
  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

export async function saveDraft(
  rt: ReleaseRuntime,
  item: QueueItem,
  output: string,
): Promise<string> {
  const filename = fieldFrom(output, "filename");
  const cid = fieldFrom(output, "cid");
  if (!filename || !cid) throw new Error("投稿输出里没有 filename 和 cid，不重新上传");
  const { csrf } = await readCookies();
  const listed = await biliCall(
    "GET",
    "https://member.bilibili.com/x/vupre/web/draft/list?pn=1&ps=30",
  );
  const count = Array.isArray(listed.data) ? listed.data.length : 0;
  if (rt.timing.draftCapacity - count <= 0) throw new Error("草稿箱已满，剩下的留在队列");
  const saved = await biliCall(
    "POST",
    `https://member.bilibili.com/x/vupre/web/draft/add?csrf=${csrf}`,
    JSON.stringify({
      copyright: item.upload.copyright,
      tid: item.upload.tid,
      title: item.upload.title,
      desc: item.upload.desc,
      tag: item.upload.tag,
      cover: item.upload.cover,
      dynamic: item.upload.dynamic,
      videos: [{ filename, title: item.title, cid: Number(cid) }],
    }),
    "application/json",
  );
  if (saved.code !== 0) throw new Error(`存草稿失败 ${saved.code} ${saved.message ?? ""}`);
  await rt.sleep(rt.timing.writeIntervalMs);
  return String((saved.data as { id?: number } | undefined)?.id ?? saved.data);
}

export async function addToSeason(
  rt: ReleaseRuntime,
  item: QueueItem,
  bvid: string,
): Promise<boolean> {
  if (!item.section_id) return false;
  let waitMs = rt.timing.addDelayMs;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    await rt.sleep(waitMs);
    const result = await rt.run([
      rt.biliup, "-u", cookiePath, "season", "add", String(item.section_id), "--vid", bvid,
    ]);
    const kind = classifySeasonAdd(result.exitCode, result.output);
    rt.log(result.output.slice(-800));
    if (kind === "ok") return true;
    if (kind === "wait-rate") { waitMs = rt.timing.editBusyWaitMs; continue; }
    if (kind === "wait-missing") { waitMs = rt.timing.notFoundWaitMs; continue; }
    return false;
  }
  return false;
}

export async function uploadById(
  rt: ReleaseRuntime,
  id: string,
  uploaded: Set<string> = new Set(),
): Promise<"uploaded" | "skipped"> {
  const queue = rt.store.load();
  const item = queue.items.find((entry) => entry.id === id || entry.video === id);
  if (!item || item.status !== "pending") throw new Error(`找不到待投稿 ${id}`);
  if (uploaded.has(item.video)) return "skipped";
  const result = await uploadItem(item, {
    cookie: cookiePath,
    bin: rt.biliup,
    retryWaitMs: rt.timing.rateLimitWaitMs,
    run: rt.run,
    sleep: rt.sleep,
    saveDraft: async (entry, output) => {
      if (entry.mode === "overwrite") {
        // 覆盖已有稿件不走草稿，草稿不会替换原来的 BV。
        if (/(?<!\d)137022(?!\d)/.test(output)) rt.onHold?.(nextLocalMidnight(Date.now()));
        throw new Error(`覆盖稿遇到投稿过于频繁，不存草稿：${entry.title}`);
      }
      return saveDraft(rt, entry, output);
    },
  });
  uploaded.add(item.video);
  if (result.status === "draft") {
    rt.store.patch(item.id, (current) => {
      current.status = "draft";
      current.draft_id = result.draftId;
    });
    throw new Error(`投稿过于频繁，已从 ${item.title} 停止`);
  }
  if (item.mode === "overwrite" && item.bvid) {
    try {
      await trimNewPart(item.bvid, item.title, item.upload.hires);
    } catch (error) {
      rt.log(error instanceof Error ? error.message : String(error));
    }
  }
  const current = rt.store.patch(item.id, (entry) => {
    entry.status = "done";
    entry.bvid = result.bvid;
    entry.finished = new Date().toISOString();
    entry.season_added = false;
  });
  if (!current) return "uploaded";
  const added = await addToSeason(rt, current, result.bvid);
  rt.store.patch(item.id, (entry) => { entry.season_added = added; });
  rt.log(`投稿完成 ${current.title} ${result.bvid}`);
  return "uploaded";
}
```

- [ ] **Step 9: 写 `admin/server/boot.ts`**

```ts
import { existsSync } from "node:fs";
import { queuePath } from "../../src/release/io";
import { openDb, type Db } from "./db/client";
import { importQueueJson } from "./queue-store";

/** 打开数据库并迁移；旧的 tmp/upload-queue.json 还在就一次性导入（成功后文件改名为 .imported）。 */
export function bootDb(file?: string): Db {
  const db = openDb(file);
  if (existsSync(queuePath)) {
    const result = importQueueJson(db, queuePath);
    if (result.imported > 0) console.log(`已从 ${queuePath} 导入 ${result.imported} 条投稿记录`);
  }
  return db;
}
```

- [ ] **Step 10: 重写 `src/release/cli.ts`**

保留 `COMMANDS`、`ReleaseArgs`、`parseReleaseArgs`、`trackFromConfig` 原样；其余整体替换成下面这些（`runBatch` 的调度逻辑不变，只把队列读写和副作用换成 `rt`）：

```ts
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { bootDb } from "../../admin/server/boot";
import { registerPrepareDir } from "../../admin/server/library";
import { createDbQueueStore } from "../../admin/server/queue-store";
import type { Db } from "../../admin/server/db/client";
import { exportVideo } from "../export/render";
import { exportAndEnqueue, outDirFor } from "./export-batch";
import { probeAudio, readTrackNumber } from "./io";
import { listReleaseTracks, type ReleaseTrack } from "./order";
import {
  assertNoOtherUpload,
  defaultRuntime,
  stampSeason,
  uploadById,
  writeCover,
  type ReleaseRuntime,
} from "./ops";
import { pendingOf, releaseItemId } from "./queue";
import { nextUpload, type ScheduleState } from "./schedule";

// ……COMMANDS / ReleaseArgs / parseReleaseArgs 原样保留……

const REGISTER_DEPS = { readTrackNumber, probe: probeAudio };

async function trackFromConfig(configPath: string): Promise<ReleaseTrack> {
  const dir = path.dirname(path.resolve(configPath));
  const tracks = await listReleaseTracks(dir, readTrackNumber);
  const resolved = path.resolve(configPath);
  const found = tracks.find((track) => path.resolve(track.configPath) === resolved);
  if (!found) throw new Error(`找不到配置 ${configPath}`);
  return found;
}

async function runBatch(
  rt: ReleaseRuntime,
  db: Db,
  mode: "then" | "and",
  prepareDir: string,
  overwriteVideo: boolean,
) {
  const dir = path.resolve(prepareDir);
  await registerPrepareDir(db, dir, REGISTER_DEPS);
  const tracks = await listReleaseTracks(dir, readTrackNumber);
  const season = await stampSeason(rt, dir, tracks);
  const ids = tracks.map((track) => releaseItemId(dir, track.index));
  const state: ScheduleState = {
    mode,
    exportDone: false,
    uploading: false,
    now: Date.now(),
    lastUploadOkAt: null,
    pendingReady: [],
  };
  let uploadChain = Promise.resolve();
  let stopped = false;
  let uploadError: unknown;
  const uploaded = new Set<string>();
  const refresh = () => {
    const queue = rt.store.load();
    state.now = Date.now();
    state.pendingReady = pendingOf(queue, ids, uploaded)
      .filter((item) => existsSync(item.video))
      .map((item) => item.id);
  };
  const kick = () => {
    uploadChain = uploadChain.then(async () => {
      while (!stopped) {
        refresh();
        const decision = nextUpload(state);
        if (decision.type === "stop" || decision.type === "idle") return;
        if (decision.type === "wait") {
          await rt.sleep(decision.ms);
          continue;
        }
        state.uploading = true;
        try {
          const outcome = await uploadById(rt, decision.id, uploaded);
          if (outcome === "uploaded") state.lastUploadOkAt = Date.now();
        } catch (error) {
          stopped = true;
          throw error;
        } finally {
          state.uploading = false;
        }
      }
    }).catch((error) => {
      stopped = true;
      uploadError = error;
      console.error(error instanceof Error ? error.message : error);
    });
  };
  let exportError: unknown;
  try {
    await exportAndEnqueue({
      tracks,
      outDir: outDirFor(dir),
      prepareDir: dir,
      overwriteVideo,
      exportVideo: async (config, out) => {
        await exportVideo({ config, out, fps: 30, concurrency: "1" });
      },
      fileExists: existsSync,
      probe: probeAudio,
      readText: (file) => readFileSync(file, "utf8"),
      loadQueue: () => rt.store.load(),
      saveQueue: (queue) => rt.store.save(queue),
      onEnqueued: (id) => {
        rt.store.patch(id, (item) => {
          item.season_id = season.seasonId;
          item.section_id = season.sectionId;
        });
        if (mode === "and") kick();
      },
      writeCover: (track, video, cover) => writeCover(rt, track, video, cover),
    });
  } catch (error) {
    exportError = error;
  }
  state.exportDone = true;
  if (mode === "and" || !exportError) kick();
  await uploadChain;
  if (exportError) throw exportError;
  if (uploadError) throw uploadError;
}

export async function main(argv: string[]): Promise<void> {
  const args = parseReleaseArgs(argv);
  const db = bootDb();
  const rt = defaultRuntime(createDbQueueStore(db));
  if (args.command === "export") {
    const dir = path.dirname(path.resolve(args.target));
    await registerPrepareDir(db, dir, REGISTER_DEPS);
    const track = await trackFromConfig(args.target);
    await exportAndEnqueue({
      tracks: [track],
      outDir: outDirFor(dir),
      prepareDir: dir,
      overwriteVideo: args.overwriteVideo,
      exportVideo: async (config, out) => {
        await exportVideo({ config, out, fps: 30, concurrency: "1" });
      },
      fileExists: existsSync,
      probe: probeAudio,
      readText: (file) => readFileSync(file, "utf8"),
      loadQueue: () => rt.store.load(),
      saveQueue: (queue) => rt.store.save(queue),
      onEnqueued: (id) => console.log(`已入队 ${id}`),
      writeCover: (entry, video, cover) => writeCover(rt, entry, video, cover),
    });
    return;
  }
  if (args.command === "upload" || args.command.endsWith("upload")) {
    await assertNoOtherUpload(rt);
  }
  if (args.command === "upload") {
    await uploadById(rt, args.target);
    return;
  }
  if (args.command === "season") {
    const dir = path.resolve(args.target);
    await registerPrepareDir(db, dir, REGISTER_DEPS);
    await stampSeason(rt, dir, await listReleaseTracks(dir, readTrackNumber));
    return;
  }
  await runBatch(
    rt,
    db,
    args.command === "export-then-upload" ? "then" : "and",
    args.target,
    args.overwriteVideo,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
```

- [ ] **Step 11: 跑测试与类型检查**

Run: `node --import ./scripts/register-ts.mjs --test src/release/*.test.ts`  
Expected: 全部 pass（包括新增的 4 + 1 + 1 个）。

Run: `nub exec tsc && nub exec tsc -p admin`  
Expected: 无输出。

- [ ] **Step 12: 用演练库手动确认 CLI 还能工作（不触发真实投稿）**

```console
RMV_DB=/tmp/release-smoke.db nub run release -- upload release-does-not-exist
```

Expected: 打印 `找不到待投稿 release-does-not-exist` 后退出码 1（说明 CLI 已经走数据库，并且 `tmp/upload-queue.json` 在演练库里被导入过一次——注意这一步会真的把 `tmp/upload-queue.json` 改名为 `.imported`，只在执行者确认要迁移时才跑；否则先 `export RMV_DB` 指向演练库并拷一份队列文件测试）。

> 提醒执行者：真实的 `tmp/upload-queue.json` 导入发生在第一次 `bootDb()`。第一次真正迁移前，先备份：`cp tmp/upload-queue.json tmp/upload-queue.json.bak`。

- [ ] **Step 13: Commit**

```console
git add src/release admin/server/boot.ts
git commit -m ":recycle: refactor(release): 抽出投稿逻辑并让队列读写走数据库"
```

---

## Task 11: 执行器

**Files:**
- Create: `admin/server/runner/executors/{support,prepare,export,cover,season,upload,publish-draft,index}.ts`
- Test: `admin/server/runner/executors/prepare.test.ts`, `admin/server/runner/executors/publish-draft.test.ts`

**Interfaces:**
- Consumes: Task 8 的 `Executor`/`JobContext`，Task 9 的 `exportVideo(args, runtime)`，Task 10 的 `ops`。
- Produces: `executors: Executors`，六个种类各一个执行器；`buildPrepareArgs(payload)`、`buildPublishBody(view, hires)`（纯函数，有测试）。
- 任务 payload 约定：
  - `prepare`：`{ audio, out?, title?, artist?, album?, lyricOffsetMs?, acceptEdgeCredits?, lyricFormat? }`
  - `export`：`{ configPath, outPath, overwriteVideo }`，`trackId` 在任务行上。
  - `cover`：`{}`，`trackId` 在任务行上；负责建/更新 `releases` 行。
  - `season`：`{}` + `albumId`（建合集/小节）；或 `{ releaseId }`（给已投稿的成片补加合集）。
  - `upload`：`{ releaseId }`。新投和覆盖共用，按 `releases.mode` 分流。
  - `publish_draft`：`{ draftId, releaseId? }`。
- 失败语义：`upload` 遇到限流存草稿或不存草稿时都以失败结束，依赖它的后续投稿被级联取消，这就是「这次空闲就停」。

- [ ] **Step 1: 测试 `prepare.test.ts`**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPrepareArgs } from "./prepare";

test("只带必填项", () => {
  assert.deepEqual(buildPrepareArgs({ audio: "/d/a.flac" }), ["src/prepare/cli.ts", "--audio", "/d/a.flac"]);
});

test("可选项按 CLI 的参数名展开", () => {
  assert.deepEqual(
    buildPrepareArgs({
      audio: "/d/a.flac", out: "/o", title: "歌", artist: "手", album: "辑",
      lyricOffsetMs: -200, acceptEdgeCredits: true, lyricFormat: "krc",
    }),
    [
      "src/prepare/cli.ts", "--audio", "/d/a.flac", "--out", "/o",
      "--title", "歌", "--artist", "手", "--album", "辑",
      "--lyric-offset", "-200", "--accept-edge-credits", "--lyric-format", "krc",
    ],
  );
});

test("偏移为 0 也要传（0 是确认过的值）", () => {
  assert.ok(buildPrepareArgs({ audio: "/d/a.flac", lyricOffsetMs: 0 }).includes("0"));
});
```

- [ ] **Step 2: 测试 `publish-draft.test.ts`**

```ts
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
```

- [ ] **Step 3: 跑测试，确认失败**

Run: `node --import ./scripts/register-ts.mjs --test admin/server/runner/executors/*.test.ts`  
Expected: FAIL（找不到模块）。

- [ ] **Step 4: `support.ts`**

```ts
import { eq } from "drizzle-orm";
import { abortableSleep, streamCommand } from "../../../../src/lib/process";
import type { ReleaseRuntime } from "../../../../src/release/ops";
import type { Db } from "../../db/client";
import {
  albums, runnerState, tracks, type AlbumRow, type TrackRow,
} from "../../db/schema";
import { createDbQueueStore } from "../../queue-store";
import type { JobContext } from "../types";

/** 把设置表里的节奏和可取消的子进程接成 ops 用的运行环境。 */
export function makeReleaseRuntime(ctx: JobContext): ReleaseRuntime {
  const s = ctx.settings;
  return {
    store: createDbQueueStore(ctx.db),
    log: (line) => ctx.log(line),
    sleep: (ms) => abortableSleep(ms, ctx.signal),
    run: async (command) => {
      const result = await streamCommand(command, {
        signal: ctx.signal,
        onLine: (line, stream) => ctx.log(line, stream),
      });
      if (result.aborted) throw new Error("已取消");
      return { exitCode: result.exitCode, output: result.output };
    },
    timing: {
      rateLimitWaitMs: s["retry.rateLimitWaitSec"] * 1000,
      writeIntervalMs: s["season.writeIntervalSec"] * 1000,
      notFoundWaitMs: s["retry.notFoundWaitSec"] * 1000,
      editBusyWaitMs: s["retry.editBusyWaitSec"] * 1000,
      addDelayMs: 4000,
      draftCapacity: s["draft.capacity"],
    },
    biliup: s["bin.biliup"],
    ffmpeg: s["bin.ffmpeg"],
    onHold: (until) => {
      ctx.log(`覆盖稿遇到 137022，暂停投稿到 ${new Date(until).toLocaleString("zh-CN")}`);
      ctx.db.update(runnerState).set({ holdUntil: until }).where(eq(runnerState.id, 1)).run();
    },
  };
}

export function requireTrack(db: Db, id: number | null): TrackRow {
  const row = id == null ? undefined : db.select().from(tracks).where(eq(tracks.id, id)).get();
  if (!row) throw new Error(`找不到曲目 #${id}`);
  if (row.configPath.startsWith("legacy:")) {
    throw new Error("这是旧队列导入的占位曲目，没有备料配置，无法导出");
  }
  return row;
}

export function requireAlbum(db: Db, id: number | null): AlbumRow {
  const row = id == null ? undefined : db.select().from(albums).where(eq(albums.id, id)).get();
  if (!row) throw new Error(`找不到专辑 #${id}`);
  return row;
}

export function markUploadOk(db: Db, now: number): void {
  db.update(runnerState).set({ lastUploadOkAt: now }).where(eq(runnerState.id, 1)).run();
}

/** 距上次成功投稿不足 upload.minIntervalSec 就在任务里等（可取消，任务保持 running）。 */
export async function waitForUploadGap(ctx: JobContext): Promise<void> {
  const state = ctx.db.select().from(runnerState).where(eq(runnerState.id, 1)).get();
  if (state?.lastUploadOkAt == null) return;
  const wait = state.lastUploadOkAt + ctx.settings["upload.minIntervalSec"] * 1000 - Date.now();
  if (wait <= 0) return;
  ctx.log(`距上次成功投稿不足 ${ctx.settings["upload.minIntervalSec"]} 秒，等待 ${Math.ceil(wait / 1000)} 秒`);
  await abortableSleep(wait, ctx.signal);
}
```

- [ ] **Step 5: `prepare.ts`**

```ts
import { streamCommand } from "../../../../src/lib/process";
import type { Executor } from "../types";

export type PreparePayload = {
  audio: string;
  out?: string;
  title?: string;
  artist?: string;
  album?: string;
  lyricOffsetMs?: number;
  acceptEdgeCredits?: boolean;
  lyricFormat?: string;
};

export function buildPrepareArgs(payload: PreparePayload): string[] {
  const args = ["src/prepare/cli.ts", "--audio", payload.audio];
  if (payload.out) args.push("--out", payload.out);
  if (payload.title) args.push("--title", payload.title);
  if (payload.artist) args.push("--artist", payload.artist);
  if (payload.album) args.push("--album", payload.album);
  if (payload.lyricOffsetMs !== undefined) args.push("--lyric-offset", String(payload.lyricOffsetMs));
  if (payload.acceptEdgeCredits) args.push("--accept-edge-credits");
  if (payload.lyricFormat) args.push("--lyric-format", payload.lyricFormat);
  return args;
}

export const prepareExecutor: Executor = async (job, ctx) => {
  const payload = job.payload as PreparePayload;
  if (!payload.audio) throw new Error("prepare 任务缺少 audio");
  const result = await streamCommand(["nub", ...buildPrepareArgs(payload)], {
    signal: ctx.signal,
    onLine: (line, stream) => ctx.log(line, stream),
  });
  if (result.aborted) throw new Error("已取消");
  if (result.exitCode !== 0) {
    // 没有歌词时备料会写出 json 但以非 0 退出，见 src/prepare/README.md
    throw new Error(`备料退出码 ${result.exitCode}（没有歌词时 json 仍会写出，查看日志）`);
  }
  return { audio: payload.audio };
};
```

- [ ] **Step 6: `export.ts`**

```ts
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { exportVideo } from "../../../../src/export/render";
import { tracks } from "../../db/schema";
import { isProgressLine, parseRenderProgress } from "../progress";
import type { Executor } from "../types";
import { requireTrack } from "./support";

export type ExportPayload = { configPath: string; outPath: string; overwriteVideo: boolean };

export const exportExecutor: Executor = async (job, ctx) => {
  const payload = job.payload as ExportPayload;
  const track = requireTrack(ctx.db, job.trackId);
  const setStatus = (exportStatus: "exported" | "failed") =>
    ctx.db.update(tracks).set({ exportStatus }).where(eq(tracks.id, track.id)).run();
  if (!payload.overwriteVideo && existsSync(payload.outPath)) {
    ctx.log(`成片已存在，跳过渲染 ${payload.outPath}`);
    setStatus("exported");
    return { out: payload.outPath, skipped: true };
  }
  let lastProgressLogAt = 0;
  try {
    const out = await exportVideo(
      {
        config: payload.configPath,
        out: payload.outPath,
        fps: 30,
        concurrency: ctx.settings["render.frameConcurrency"],
      },
      {
        signal: ctx.signal,
        onLog: (line, stream) => {
          if (isProgressLine(line)) {
            const progress = parseRenderProgress(line);
            if (progress != null) ctx.progress(progress);
            // 进度行很密，日志里每 5 秒留一条
            const now = Date.now();
            if (now - lastProgressLogAt < 5000) return;
            lastProgressLogAt = now;
          }
          ctx.log(line, stream);
        },
      },
    );
    setStatus("exported");
    ctx.progress(1);
    return { out, skipped: false };
  } catch (error) {
    if (!ctx.signal.aborted) setStatus("failed");
    throw error;
  }
};
```

- [ ] **Step 7: `cover.ts`**

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { exportAndEnqueue, outDirFor } from "../../../../src/release/export-batch";
import { probeAudio, readTrackNumber } from "../../../../src/release/io";
import { listReleaseTracks } from "../../../../src/release/order";
import { writeCover } from "../../../../src/release/ops";
import { albums } from "../../db/schema";
import type { Executor } from "../types";
import { makeReleaseRuntime, requireTrack } from "./support";

/** 抽封面并建/更新 releases 行。成片已经由 export 任务渲好，这里不再渲染。 */
export const coverExecutor: Executor = async (job, ctx) => {
  const track = requireTrack(ctx.db, job.trackId);
  const rt = makeReleaseRuntime(ctx);
  const listed = await listReleaseTracks(track.prepareDir, readTrackNumber);
  const target = listed.find(
    (entry) => path.resolve(entry.configPath) === path.resolve(track.configPath),
  );
  if (!target) throw new Error(`找不到配置 ${track.configPath}`);
  const album = track.albumId != null
    ? ctx.db.select().from(albums).where(eq(albums.id, track.albumId)).get()
    : undefined;
  const enqueued: string[] = [];
  await exportAndEnqueue({
    tracks: [target],
    outDir: outDirFor(track.prepareDir),
    prepareDir: track.prepareDir,
    overwriteVideo: false,
    exportVideo: async () => undefined,
    fileExists: () => true,
    probe: probeAudio,
    readText: (file) => readFileSync(file, "utf8"),
    loadQueue: () => rt.store.load(),
    saveQueue: (queue) => rt.store.save(queue),
    onEnqueued: (id) => {
      enqueued.push(id);
      if (album?.seasonId && album.sectionId) {
        rt.store.patch(id, (item) => {
          item.season_id = album.seasonId ?? undefined;
          item.section_id = album.sectionId ?? undefined;
        });
      }
    },
    writeCover: (entry, video, cover) => writeCover(rt, entry, video, cover),
  });
  return { releaseId: enqueued[0] ?? null };
};
```

- [ ] **Step 8: `season.ts`**

```ts
import { eq } from "drizzle-orm";
import { readTrackNumber } from "../../../../src/release/io";
import { listReleaseTracks } from "../../../../src/release/order";
import { addToSeason, stampSeason } from "../../../../src/release/ops";
import { albums, releases, tracks } from "../../db/schema";
import type { Executor } from "../types";
import { makeReleaseRuntime, requireAlbum } from "./support";

export const seasonExecutor: Executor = async (job, ctx) => {
  const rt = makeReleaseRuntime(ctx);
  const releaseId = typeof job.payload.releaseId === "string" ? job.payload.releaseId : undefined;
  if (releaseId) {
    // 给已经投稿的成片补加入合集
    const item = rt.store.load().items.find((entry) => entry.id === releaseId);
    if (!item) throw new Error(`找不到成片 ${releaseId}`);
    if (item.status !== "done" || !item.bvid) throw new Error("这条还没有投稿完成，没有稿件号");
    if (!item.section_id) {
      const row = ctx.db.select().from(releases).where(eq(releases.id, releaseId)).get();
      const track = row?.trackId != null
        ? ctx.db.select().from(tracks).where(eq(tracks.id, row.trackId)).get()
        : undefined;
      const album = track?.albumId != null
        ? ctx.db.select().from(albums).where(eq(albums.id, track.albumId)).get()
        : undefined;
      if (!album?.seasonId || !album.sectionId) throw new Error("这张专辑还没有建合集，先建合集");
      rt.store.patch(releaseId, (entry) => {
        entry.season_id = album.seasonId ?? undefined;
        entry.section_id = album.sectionId ?? undefined;
      });
      item.section_id = album.sectionId;
    }
    const added = await addToSeason(rt, item, item.bvid);
    rt.store.patch(releaseId, (entry) => { entry.season_added = added; });
    if (!added) throw new Error("加入合集失败，查看日志");
    return { added };
  }
  const album = requireAlbum(ctx.db, job.albumId);
  const listed = await listReleaseTracks(album.prepareDir, readTrackNumber);
  const season = await stampSeason(rt, album.prepareDir, listed);
  ctx.db.update(albums)
    .set({ seasonId: season.seasonId, sectionId: season.sectionId })
    .where(eq(albums.id, album.id))
    .run();
  return season;
};
```

- [ ] **Step 9: `upload.ts`**

```ts
import { assertNoOtherUpload, uploadById } from "../../../../src/release/ops";
import type { Executor } from "../types";
import { makeReleaseRuntime, markUploadOk, waitForUploadGap } from "./support";

export const uploadExecutor: Executor = async (job, ctx) => {
  const releaseId = String(job.payload.releaseId ?? job.releaseId ?? "");
  if (!releaseId) throw new Error("upload 任务缺少 releaseId");
  const rt = makeReleaseRuntime(ctx);
  await waitForUploadGap(ctx);
  // runner 自己会起 biliup 子进程，只防「别的 release CLI 正在投稿」。
  // bili.maxParallel > 1 时用户已经选择了并行，不再互斥。
  if (ctx.settings["bili.maxParallel"] === 1) {
    await assertNoOtherUpload(rt, "src/release/cli.ts");
  }
  const outcome = await uploadById(rt, releaseId, new Set());
  if (outcome === "uploaded") markUploadOk(ctx.db, Date.now());
  return { outcome };
};
```

- [ ] **Step 10: `publish-draft.ts`**

> 这一个执行器依赖 B 站草稿接口（`draft/view`、`add/v3`、`draft/delete`）的真实返回，计划阶段没法离线验证。设计上保证安全：任何一步失败，草稿原样留在草稿箱；只有拿到 BV 号之后才删除草稿，删除失败只记日志、不重试。Task 15 有一步用真实草稿验证，字段对不上时只改 `buildPublishBody`。

```ts
import { eq } from "drizzle-orm";
import { biliCall, readCookies } from "../../../../src/release/io";
import { addToSeason } from "../../../../src/release/ops";
import { releases } from "../../db/schema";
import type { Executor } from "../types";
import { makeReleaseRuntime, markUploadOk } from "./support";

/** 稿件级字段。不带 aid：这是新发布，不是编辑。 */
const PUBLISH_KEYS = [
  "copyright", "source", "tid", "cover", "title", "desc_format_id", "desc", "desc_v2",
  "dynamic", "tag", "interactive", "no_reprint", "charging_pay",
  "is_only_self", "mission_id", "dtime",
];

type DraftVideo = { filename: string; title?: string; desc?: string; cid: number };

export function buildPublishBody(
  view: Record<string, unknown>,
  hires: number,
): Record<string, unknown> {
  const source = (view.archive as Record<string, unknown> | undefined) ?? view;
  const videos = (view.videos ?? source.videos) as DraftVideo[] | undefined;
  if (!videos || videos.length === 0) throw new Error("草稿里没有视频，无法发布");
  const body: Record<string, unknown> = {};
  for (const key of PUBLISH_KEYS) {
    if (source[key] != null) body[key] = source[key];
  }
  body.videos = videos.map((video) => ({
    filename: video.filename,
    title: video.title ?? "",
    desc: video.desc ?? "",
    cid: video.cid,
  }));
  body.subtitle = { open: 0, lan: "" };
  body.dolby = 0;
  body.lossless_music = hires;
  body.up_selection_reply = false;
  body.up_close_reply = false;
  body.up_close_danmu = false;
  body.web_os = 3;
  return body;
}

export const publishDraftExecutor: Executor = async (job, ctx) => {
  const draftId = String(job.payload.draftId ?? "");
  if (!draftId) throw new Error("publish_draft 任务缺少 draftId");
  const rt = makeReleaseRuntime(ctx);
  const releaseId = String(job.payload.releaseId ?? job.releaseId ?? "");
  const release = releaseId
    ? ctx.db.select().from(releases).where(eq(releases.id, releaseId)).get()
    : undefined;

  const viewed = await biliCall(
    "GET",
    `https://member.bilibili.com/x/vupre/web/draft/view?id=${encodeURIComponent(draftId)}`,
  );
  if (viewed.code !== 0) throw new Error(`读取草稿失败 ${viewed.code} ${viewed.message ?? ""}`);
  const body = buildPublishBody(
    (viewed.data ?? {}) as Record<string, unknown>,
    release?.uploadHires ?? 0,
  );

  const { csrf } = await readCookies();
  const added = await biliCall(
    "POST",
    `https://member.bilibili.com/x/vu/web/add/v3?csrf=${csrf}`,
    JSON.stringify(body),
    "application/json",
  );
  if (added.code !== 0) {
    throw new Error(`发布草稿失败 ${added.code} ${added.message ?? ""}，草稿保留`);
  }
  const bvid = String((added.data as { bvid?: string } | undefined)?.bvid ?? "");
  if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) throw new Error("发布返回里没有 BV 号，草稿保留");
  markUploadOk(ctx.db, Date.now());
  ctx.log(`草稿 ${draftId} 已发布 ${bvid}`);

  // 先把结果记下来，再做删除草稿和加合集这些可以失败的收尾。
  let seasonAdded: boolean | undefined;
  if (releaseId) {
    const current = rt.store.patch(releaseId, (item) => {
      item.status = "done";
      item.bvid = bvid;
      item.finished = new Date().toISOString();
      item.season_added = false;
    });
    if (current) {
      seasonAdded = await addToSeason(rt, current, bvid);
      rt.store.patch(releaseId, (item) => { item.season_added = seasonAdded; });
    }
  }

  await rt.sleep(rt.timing.writeIntervalMs);
  const deleted = await biliCall(
    "POST",
    `https://member.bilibili.com/x/vupre/web/draft/delete?csrf=${csrf}`,
    new URLSearchParams({ id: draftId }).toString(),
    "application/x-www-form-urlencoded",
  );
  if (deleted.code !== 0) {
    ctx.log(`草稿 ${draftId} 删除失败 ${deleted.code} ${deleted.message ?? ""}。不重试，请到草稿箱手动删除`);
  }
  return { bvid, seasonAdded, draftDeleted: deleted.code === 0 };
};
```

- [ ] **Step 11: `index.ts`**

```ts
import type { Executors } from "../types";
import { coverExecutor } from "./cover";
import { exportExecutor } from "./export";
import { prepareExecutor } from "./prepare";
import { publishDraftExecutor } from "./publish-draft";
import { seasonExecutor } from "./season";
import { uploadExecutor } from "./upload";

export const executors: Executors = {
  prepare: prepareExecutor,
  export: exportExecutor,
  cover: coverExecutor,
  season: seasonExecutor,
  upload: uploadExecutor,
  publish_draft: publishDraftExecutor,
};
```

- [ ] **Step 12: 跑测试与类型检查**

Run: `node --import ./scripts/register-ts.mjs --test admin/server/runner/executors/*.test.ts`  
Expected: 6 个测试 pass。

Run: `nub exec tsc -p admin`  
Expected: 无输出。

- [ ] **Step 13: Commit**

```console
git add admin/server/runner/executors
git commit -m ":sparkles: feat(admin): 添加备料、导出、封面、合集、投稿和发布草稿执行器"
```

---

## Task 12: 任务编排与空闲调度

**Files:**
- Create: `admin/server/orchestrate.ts`, `admin/server/idle-scheduler.ts`, `admin/server/bili.ts`
- Test: `admin/server/orchestrate.test.ts`, `admin/server/idle-scheduler.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `enqueueJob`，Task 8 的 `decideIdle`，Task 10 的 `outDirFor`/`videoPathFor`。
- Produces:
  - `planExport(db, { mode, albumId?, trackIds?, overwriteVideo? }, now?) → JobRow[]`：`mode` 为 `export`、`export-then-upload`、`export-and-upload`。每首曲目 `export → cover`；有上传时，专辑里需要建合集的先排一个 `season`（`cover` 依赖它，`export` 不依赖，不挡渲染）；上传在 `bili` lane 串成一条链，`then` 模式每个上传依赖全部 `cover`，`and` 模式依赖自己那首的 `cover`。
  - `planUpload(db, { releaseIds }, now?) → JobRow[]`：`pending` 的排 `upload`，`draft` 的排 `publish_draft`，串成链；同一条已有未结束的投稿任务时拒绝；覆盖稿没有 `bvid` 时拒绝。
  - `enqueueIdleJobs(db, now, listDraftIds) → JobRow[]`：`bili` 有未结束任务时不排；先发布草稿（队列里 `draft` 按 `created_at`，接着草稿箱里数据库没记的），再 `pending` 的投稿，串成一条链。
  - `createIdleHook(db, deps)`：返回 `runner` 的 `onTick` 钩子。写 `locked_since`；空闲时排队；失败的链在同一个空闲窗口内不再重排，离开空闲窗口后复位。
  - `bili.ts`：`fetchDrafts()`、`listDraftIds()`（失败时记 warning 返回空）。

- [ ] **Step 1: 测试 `orchestrate.test.ts`**

```ts
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
```

- [ ] **Step 2: 测试 `idle-scheduler.test.ts`**

```ts
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
```

- [ ] **Step 3: 跑测试，确认失败**

Run: `node --import ./scripts/register-ts.mjs --test admin/server/orchestrate.test.ts admin/server/idle-scheduler.test.ts`  
Expected: FAIL（找不到模块）。

- [ ] **Step 4: 写 `orchestrate.ts`**

```ts
import { and, eq, inArray } from "drizzle-orm";
import { outDirFor, videoPathFor } from "../../src/release/export-batch";
import { releaseItemId } from "../../src/release/queue";
import type { Conn, Db } from "./db/client";
import { albums, jobs, releases, tracks, type JobRow, type TrackRow } from "./db/schema";
import { enqueueJob, type NewJob } from "./jobs";

export type ExportMode = "export" | "export-then-upload" | "export-and-upload";

export type PlanExportInput = {
  mode: ExportMode;
  albumId?: number;
  trackIds?: number[];
  overwriteVideo?: boolean;
};

function selectTracks(conn: Conn, input: PlanExportInput): TrackRow[] {
  let rows: TrackRow[];
  if (input.albumId != null) {
    rows = conn.select().from(tracks).where(eq(tracks.albumId, input.albumId)).all();
    if (input.trackIds?.length) {
      const wanted = new Set(input.trackIds);
      rows = rows.filter((row) => wanted.has(row.id));
    }
  } else if (input.trackIds?.length) {
    rows = conn.select().from(tracks).where(inArray(tracks.id, input.trackIds)).all();
  } else {
    throw new Error("需要指定专辑或曲目");
  }
  if (rows.length === 0) throw new Error("没有可导出的曲目");
  for (const row of rows) {
    if (row.configPath.startsWith("legacy:")) {
      throw new Error(`《${row.title}》是旧队列导入的占位曲目，没有备料配置，无法导出`);
    }
  }
  return rows.sort((a, b) => (a.trackNo ?? 0) - (b.trackNo ?? 0) || a.id - b.id);
}

export function planExport(db: Db, input: PlanExportInput, now: number = Date.now()): JobRow[] {
  return db.transaction((tx) => {
    const selected = selectTracks(tx, input);
    const withUpload = input.mode !== "export";
    const created: JobRow[] = [];
    const add = (job: NewJob): JobRow => {
      const row = enqueueJob(tx, job, now);
      created.push(row);
      return row;
    };

    const seasonJobs = new Map<number, JobRow>();
    if (withUpload) {
      const albumIds = [...new Set(selected.flatMap((row) => (row.albumId == null ? [] : [row.albumId])))];
      for (const albumId of albumIds) {
        const album = tx.select().from(albums).where(eq(albums.id, albumId)).get();
        if (album?.seasonId && album.sectionId) continue;
        seasonJobs.set(albumId, add({ kind: "season", albumId }));
      }
    }

    const covers: JobRow[] = [];
    for (const track of selected) {
      const albumId = track.albumId ?? undefined;
      const outPath = videoPathFor(outDirFor(track.prepareDir), track.artist, track.title);
      const exported = add({
        kind: "export",
        trackId: track.id,
        albumId,
        payload: {
          configPath: track.configPath,
          outPath,
          overwriteVideo: Boolean(input.overwriteVideo),
        },
      });
      const season = track.albumId != null ? seasonJobs.get(track.albumId) : undefined;
      covers.push(add({
        kind: "cover",
        trackId: track.id,
        albumId,
        dependsOn: [exported.id, ...(season ? [season.id] : [])],
      }));
    }
    if (!withUpload) return created;

    let previous: JobRow | undefined;
    selected.forEach((track, index) => {
      const releaseId = releaseItemId(track.prepareDir, track.trackNo ?? index + 1);
      const own = covers[index];
      const dependsOn = input.mode === "export-then-upload"
        ? covers.map((cover) => cover.id)
        : own ? [own.id] : [];
      if (previous) dependsOn.push(previous.id);
      previous = add({
        kind: "upload",
        trackId: track.id,
        albumId: track.albumId ?? undefined,
        releaseId,
        dependsOn,
        payload: { releaseId },
      });
    });
    return created;
  });
}

const ACTIVE = ["queued", "running", "cancel_requested"] as const;

export function activeReleaseJob(conn: Conn, releaseId: string): JobRow | undefined {
  return conn.select().from(jobs)
    .where(and(
      eq(jobs.releaseId, releaseId),
      inArray(jobs.kind, ["upload", "publish_draft"]),
      inArray(jobs.status, [...ACTIVE]),
    ))
    .get();
}

export function planUpload(
  db: Db,
  input: { releaseIds: string[] },
  now: number = Date.now(),
): JobRow[] {
  return db.transaction((tx) => {
    const created: JobRow[] = [];
    let previous: JobRow | undefined;
    for (const id of input.releaseIds) {
      const row = tx.select().from(releases).where(eq(releases.id, id)).get();
      if (!row) throw new Error(`找不到成片 ${id}`);
      if (row.status === "done") throw new Error(`《${row.title}》已投稿`);
      if (activeReleaseJob(tx, id)) throw new Error(`《${row.title}》已在队列中`);
      if (row.status === "pending" && row.mode === "overwrite" && !row.bvid) {
        throw new Error(`覆盖投稿缺少稿件号：《${row.title}》`);
      }
      const dependsOn = previous ? [previous.id] : [];
      previous = row.status === "draft"
        ? enqueueJob(tx, {
          kind: "publish_draft",
          trackId: row.trackId ?? undefined,
          releaseId: id,
          dependsOn,
          payload: { releaseId: id, draftId: row.draftId },
        }, now)
        : enqueueJob(tx, {
          kind: "upload",
          trackId: row.trackId ?? undefined,
          releaseId: id,
          dependsOn,
          payload: { releaseId: id },
        }, now);
      created.push(previous);
    }
    return created;
  });
}
```

- [ ] **Step 5: 写 `bili.ts`**

```ts
import { biliCall } from "../../src/release/io";

export type DraftSummary = { id: string; title: string };

export async function fetchDrafts(): Promise<DraftSummary[]> {
  const body = await biliCall(
    "GET",
    "https://member.bilibili.com/x/vupre/web/draft/list?pn=1&ps=30",
  );
  if (body.code !== 0) throw new Error(`读取草稿箱失败 ${body.code} ${body.message ?? ""}`);
  const list = Array.isArray(body.data) ? body.data as Record<string, unknown>[] : [];
  return list.map((item) => ({
    id: String(item.id ?? item.draft_id ?? ""),
    title: String(item.title ?? (item.archive as { title?: string } | undefined)?.title ?? ""),
  })).filter((item) => item.id);
}

/** 读取失败（没登录、网络断）时只警告，当作草稿箱里没有数据库没记下的草稿。 */
export async function listDraftIds(): Promise<string[]> {
  try {
    return (await fetchDrafts()).map((draft) => draft.id);
  } catch (error) {
    console.warn(error instanceof Error ? error.message : error);
    return [];
  }
}
```

- [ ] **Step 6: 写 `idle-scheduler.ts`**

```ts
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "./db/client";
import { jobs, releases, runnerState, type JobRow } from "./db/schema";
import { enqueueJob, type NewJob } from "./jobs";
import { decideIdle } from "./runner/idle";
import type { Settings } from "./settings";

const ACTIVE = ["queued", "running", "cancel_requested"] as const;

export async function enqueueIdleJobs(
  db: Db,
  now: number,
  listDraftIds: () => Promise<string[]>,
): Promise<JobRow[]> {
  const busy = db.select({ id: jobs.id }).from(jobs)
    .where(and(eq(jobs.lane, "bili"), inArray(jobs.status, [...ACTIVE]))).get();
  if (busy) return [];

  const rows = db.select().from(releases).orderBy(asc(releases.createdAt), asc(releases.id)).all();
  const drafts = rows.filter((row) => row.status === "draft" && row.draftId);
  const pending = rows.filter((row) =>
    row.status === "pending" && !(row.mode === "overwrite" && !row.bvid));
  const known = new Set(drafts.map((row) => row.draftId));
  const unknown = (await listDraftIds()).filter((id) => !known.has(id));

  const plan: NewJob[] = [
    ...drafts.map((row): NewJob => ({
      kind: "publish_draft",
      trackId: row.trackId ?? undefined,
      releaseId: row.id,
      payload: { releaseId: row.id, draftId: row.draftId },
    })),
    ...unknown.map((draftId): NewJob => ({ kind: "publish_draft", payload: { draftId } })),
    ...pending.map((row): NewJob => ({
      kind: "upload",
      trackId: row.trackId ?? undefined,
      releaseId: row.id,
      payload: { releaseId: row.id },
    })),
  ];
  if (plan.length === 0) return [];

  return db.transaction((tx) => {
    const created: JobRow[] = [];
    for (const job of plan) {
      const previous = created.at(-1);
      created.push(enqueueJob(tx, { ...job, dependsOn: previous ? [previous.id] : [] }, now));
    }
    return created;
  });
}

export type IdleDeps = {
  now: () => number;
  screenLocked: () => Promise<boolean>;
  listDraftIds: () => Promise<string[]>;
};

export function createIdleHook(db: Db, deps: IdleDeps): (settings: Settings) => Promise<void> {
  let nextCheckAt = 0;
  let chain: number[] = [];
  let halted = false;
  return async (settings) => {
    const now = deps.now();
    if (now < nextCheckAt) return;
    nextCheckAt = now + settings["idle.tickSec"] * 1000;

    const state = db.select().from(runnerState).where(eq(runnerState.id, 1)).get();
    const locked = settings["idle.enabled"] ? await deps.screenLocked() : false;
    const decision = decideIdle({
      now,
      enabled: settings["idle.enabled"],
      holdUntil: state?.holdUntil ?? null,
      nightStartHour: settings["idle.nightStartHour"],
      nightEndHour: settings["idle.nightEndHour"],
      lockMinutes: settings["idle.lockMinutes"],
      locked,
      lockedSince: state?.lockedSince ?? null,
    });
    if (decision.lockedSince !== (state?.lockedSince ?? null)) {
      db.update(runnerState).set({ lockedSince: decision.lockedSince })
        .where(eq(runnerState.id, 1)).run();
    }
    if (!decision.idle) {
      halted = false;
      chain = [];
      return;
    }
    if (chain.length > 0) {
      const rows = db.select().from(jobs).where(inArray(jobs.id, chain)).all();
      if (rows.some((row) => (ACTIVE as readonly string[]).includes(row.status))) return;
      // 链里有失败或被级联取消的：这次空闲窗口就停
      if (rows.some((row) => row.status !== "succeeded")) halted = true;
      chain = [];
    }
    if (halted) return;
    chain = (await enqueueIdleJobs(db, now, deps.listDraftIds)).map((job) => job.id);
  };
}
```

- [ ] **Step 7: 跑测试与类型检查**

Run: `node --import ./scripts/register-ts.mjs --test admin/server/orchestrate.test.ts admin/server/idle-scheduler.test.ts`  
Expected: 8 + 6 个测试 pass。

Run: `nub exec tsc -p admin`  
Expected: 无输出。

- [ ] **Step 8: Commit**

```console
git add admin/server/orchestrate.ts admin/server/idle-scheduler.ts admin/server/bili.ts admin/server/orchestrate.test.ts admin/server/idle-scheduler.test.ts
git commit -m ":sparkles: feat(admin): 添加导出投稿编排和空闲自动投稿调度"
```

---

## Task 13: 路径白名单与变更轮询

**Files:**
- Create: `admin/server/paths.ts`, `admin/server/changes.ts`, `admin/server/db/instance.ts`
- Test: `admin/server/paths.test.ts`, `admin/server/changes.test.ts`

**Interfaces:**
- Produces:
  - `PREPARE_ROOT()`、`assertInside(root, target) → 绝对路径`（越界抛错）。
  - `pollJobChanges(db, signal, { since?, pollMs? })`：异步生成器，按 `updated_at` 轮询，每次只给新变化的任务行；用 `(id, updated_at)` 去重，所以同一毫秒内先后写入的更新不会漏。
  - `pollLogs(db, jobId, afterId, signal, pollMs?)`：异步生成器，给新增日志行。
  - `getDb()`：进程内单例（挂在 `globalThis` 上，Vite 热更新不会重复打开）。

- [ ] **Step 1: 测试**

`admin/server/paths.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { assertInside } from "./paths";

test("白名单内的路径返回绝对路径，越界和 .. 逃逸都拒绝", () => {
  assert.equal(assertInside("/proj/预处理", "/proj/预处理/寻雾"), "/proj/预处理/寻雾");
  assert.throws(() => assertInside("/proj/预处理", "/etc/passwd"), /不在允许范围/);
  assert.throws(() => assertInside("/proj/预处理", "/proj/预处理/../out"), /不在允许范围/);
  assert.throws(() => assertInside("/proj/预处理", "/proj/预处理x"), /不在允许范围/);
});
```

`admin/server/changes.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { openDb } from "./db/client";
import { appendLogs, enqueueJob } from "./jobs";
import { pollJobChanges, pollLogs } from "./changes";

test("先给出已有变化，之后只给新变化，中止后结束", async () => {
  const db = openDb(":memory:");
  const a = enqueueJob(db, { kind: "export" }, 100);
  const controller = new AbortController();
  const seen: number[][] = [];
  const done = (async () => {
    for await (const batch of pollJobChanges(db, controller.signal, { since: 0, pollMs: 10 })) {
      seen.push(batch.map((job) => job.id));
      if (seen.length === 2) controller.abort();
    }
  })();
  await delay(60);
  const b = enqueueJob(db, { kind: "export" }, 200);
  await done;
  assert.deepEqual(seen, [[a.id], [b.id]]);
});

test("日志只给 afterId 之后的新行", async () => {
  const db = openDb(":memory:");
  const job = enqueueJob(db, { kind: "export" }, 1);
  appendLogs(db, job.id, [{ stream: "stdout", line: "one" }], 2, 100);
  const controller = new AbortController();
  const seen: string[][] = [];
  const done = (async () => {
    for await (const rows of pollLogs(db, job.id, 0, controller.signal, 10)) {
      seen.push(rows.map((row) => row.line));
      if (seen.length === 2) controller.abort();
    }
  })();
  await delay(60);
  appendLogs(db, job.id, [{ stream: "stderr", line: "two" }], 3, 100);
  await done;
  assert.deepEqual(seen, [["one"], ["two"]]);
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `node --import ./scripts/register-ts.mjs --test admin/server/paths.test.ts admin/server/changes.test.ts`  
Expected: FAIL（找不到模块）。

- [ ] **Step 3: 实现**

`admin/server/paths.ts`：

```ts
import path from "node:path";

export const PREPARE_ROOT = (): string => path.join(process.cwd(), "预处理");

/** 路径必须落在 root 里面（含 root 自己）。返回解析后的绝对路径。 */
export function assertInside(root: string, target: string): string {
  const resolved = path.resolve(target);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`路径不在允许范围内: ${target}`);
  }
  return resolved;
}
```

`admin/server/changes.ts`：

```ts
import { asc, gte } from "drizzle-orm";
import { abortableSleep } from "../../src/lib/process";
import type { Db } from "./db/client";
import { jobs, type JobRow } from "./db/schema";
import { listLogs } from "./jobs";

const nap = (ms: number, signal: AbortSignal) => abortableSleep(ms, signal).catch(() => undefined);

export async function* pollJobChanges(
  db: Db,
  signal: AbortSignal,
  options: { since?: number; pollMs?: number } = {},
): AsyncGenerator<JobRow[]> {
  let cursor = options.since ?? 0;
  const seen = new Map<number, number>();
  while (!signal.aborted) {
    const rows = db.select().from(jobs).where(gte(jobs.updatedAt, cursor))
      .orderBy(asc(jobs.updatedAt), asc(jobs.id)).all();
    const fresh = rows.filter((row) => seen.get(row.id) !== row.updatedAt);
    if (fresh.length > 0) {
      for (const row of fresh) seen.set(row.id, row.updatedAt);
      cursor = Math.max(cursor, ...fresh.map((row) => row.updatedAt));
      for (const [id, at] of seen) if (at < cursor) seen.delete(id);
      yield fresh;
    }
    await nap(options.pollMs ?? 1000, signal);
  }
}

export async function* pollLogs(
  db: Db,
  jobId: number,
  afterId: number,
  signal: AbortSignal,
  pollMs = 700,
): AsyncGenerator<ReturnType<typeof listLogs>> {
  let cursor = afterId;
  while (!signal.aborted) {
    const rows = listLogs(db, jobId, cursor);
    const last = rows.at(-1);
    if (last) {
      cursor = last.id;
      yield rows;
    }
    await nap(pollMs, signal);
  }
}
```

`admin/server/db/instance.ts`：

```ts
import { bootDb } from "../boot";
import type { Db } from "./client";

const KEY = Symbol.for("rmv.admin.db");

/** web 进程里共用一个连接。挂在 globalThis 上，开发时热更新不会重复打开。 */
export function getDb(): Db {
  const holder = globalThis as Record<symbol, Db | undefined>;
  holder[KEY] ??= bootDb();
  return holder[KEY];
}
```

- [ ] **Step 4: 跑测试与类型检查**

Run: `node --import ./scripts/register-ts.mjs --test admin/server/paths.test.ts admin/server/changes.test.ts`  
Expected: 3 个测试 pass。

Run: `nub exec tsc -p admin`  
Expected: 无输出。

- [ ] **Step 5: Commit**

```console
git add admin/server/paths.ts admin/server/changes.ts admin/server/db/instance.ts admin/server/paths.test.ts admin/server/changes.test.ts
git commit -m ":sparkles: feat(admin): 添加路径白名单、变更轮询和数据库单例"
```

---

## Task 14: tRPC 路由

**Files:**
- Create: `admin/server/trpc/{init,context}.ts`, `admin/server/trpc/routers/{labels,overview,library,jobs,releases,seasons,history,settings,system}.ts`, `admin/server/router.ts`
- Test: `admin/server/router.test.ts`

**Interfaces:**
- Consumes: 前面所有任务。
- Produces（前端靠 `AppRouter` 类型取用）：

| 路由 | 过程 |
| --- | --- |
| `overview` | `get`：runner 在线、`runner_state`、任务与成片计数、在跑任务、设置警告 |
| `library` | `albums`、`album({id})`、`singles`、`scan`（列出 `预处理/` 下的目录及是否已登记）、`register({dir})`、`archive({id, archived})` |
| `jobs` | `list`、`get`、`logs`、`enqueueExport`、`enqueuePrepare`、`cancel`、`retry`、`subscribe`（SSE，只推变化的任务 id）、`subscribeLogs`（SSE，推新日志行） |
| `releases` | `list`、`get`、`updateUpload`（仅 `pending` 且无进行中的任务）、`enqueueUpload({ids})`（pending 排 upload、draft 排 publish_draft）、`remove`（仅 `pending`）、`regenCover`、`draftBox` |
| `seasons` | `list`（实时读 B 站）、`ensureForAlbum`、`addRelease` |
| `history` | `exports`、`uploads`、`stats` |
| `settings` | `get`、`update`、`reset` |
| `system` | `health`：登录态是否存在及过期时间、`biliup`/`ffmpeg`/`nub` 是否可用、`out/` 所在磁盘剩余空间、数据库文件 |

- 所有输入用 zod 校验；路径输入必须过 `assertInside` 或存在性检查；写操作拒绝时抛 `TRPCError`（`BAD_REQUEST` / `NOT_FOUND`）而不是静默忽略。

- [ ] **Step 1: 测试 `admin/server/router.test.ts`**

```ts
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
  assert.equal(updated.uploadTitle, "新标题");
  assert.equal(updated.uploadTid, 3);
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
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `node --import ./scripts/register-ts.mjs --test admin/server/router.test.ts`  
Expected: FAIL（找不到 `./router`）。

- [ ] **Step 3: `trpc/init.ts` 与 `trpc/context.ts`**

```ts
// admin/server/trpc/init.ts
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { Db } from "../db/client";

export type Context = { db: Db };

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;
```

```ts
// admin/server/trpc/context.ts
import { getDb } from "../db/instance";
import type { Context } from "./init";

export function createContext(): Context {
  return { db: getDb() };
}
```

- [ ] **Step 4: `routers/labels.ts`（给任务行补曲目、专辑名）**

```ts
import { inArray } from "drizzle-orm";
import type { Conn } from "../../db/client";
import { albums, tracks, type JobRow } from "../../db/schema";

export type LabeledJob = JobRow & { trackTitle: string | null; albumTitle: string | null };

export function withLabels(conn: Conn, rows: JobRow[]): LabeledJob[] {
  const trackIds = [...new Set(rows.flatMap((row) => (row.trackId == null ? [] : [row.trackId])))];
  const trackRows = trackIds.length
    ? conn.select().from(tracks).where(inArray(tracks.id, trackIds)).all()
    : [];
  const albumIds = [...new Set([
    ...rows.flatMap((row) => (row.albumId == null ? [] : [row.albumId])),
    ...trackRows.flatMap((row) => (row.albumId == null ? [] : [row.albumId])),
  ])];
  const albumRows = albumIds.length
    ? conn.select().from(albums).where(inArray(albums.id, albumIds)).all()
    : [];
  const trackById = new Map(trackRows.map((row) => [row.id, row]));
  const albumById = new Map(albumRows.map((row) => [row.id, row]));
  return rows.map((row) => {
    const track = row.trackId == null ? undefined : trackById.get(row.trackId);
    const albumId = row.albumId ?? track?.albumId ?? null;
    return {
      ...row,
      trackTitle: track?.title ?? null,
      albumTitle: albumId == null ? null : albumById.get(albumId)?.title ?? null,
    };
  });
}
```

- [ ] **Step 5: `routers/overview.ts`**

```ts
import { asc, eq, inArray, sql } from "drizzle-orm";
import { jobs, releases, runnerState } from "../../db/schema";
import { runnerOnline } from "../../runner/lock";
import { getSettings, settingWarnings } from "../../settings";
import { publicProcedure, router } from "../init";
import { withLabels } from "./labels";

export const overviewRouter = router({
  get: publicProcedure.query(({ ctx }) => {
    const now = Date.now();
    const state = ctx.db.select().from(runnerState).where(eq(runnerState.id, 1)).get();
    const jobCounts = ctx.db
      .select({ status: jobs.status, count: sql<number>`count(*)`.mapWith(Number) })
      .from(jobs).groupBy(jobs.status).all();
    const releaseCounts = ctx.db
      .select({ status: releases.status, count: sql<number>`count(*)`.mapWith(Number) })
      .from(releases).groupBy(releases.status).all();
    const running = ctx.db.select().from(jobs)
      .where(inArray(jobs.status, ["running", "cancel_requested"]))
      .orderBy(asc(jobs.id)).all();
    return {
      now,
      runner: { online: runnerOnline(state?.heartbeatAt ?? null, now), pid: state?.pid ?? null },
      state: {
        lockedSince: state?.lockedSince ?? null,
        holdUntil: state?.holdUntil ?? null,
        lastUploadOkAt: state?.lastUploadOkAt ?? null,
      },
      jobCounts: Object.fromEntries(jobCounts.map((row) => [row.status, row.count])) as Record<string, number>,
      releaseCounts: Object.fromEntries(releaseCounts.map((row) => [row.status, row.count])) as Record<string, number>,
      running: withLabels(ctx.db, running),
      warnings: settingWarnings(getSettings(ctx.db)),
    };
  }),
});
```

- [ ] **Step 6: `routers/library.ts`**

```ts
import { readdir } from "node:fs/promises";
import path from "node:path";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull, notLike, sql } from "drizzle-orm";
import { z } from "zod";
import { probeAudio, readTrackNumber } from "../../../../src/release/io";
import { albums, releases, tracks } from "../../db/schema";
import { registerPrepareDir } from "../../library";
import { PREPARE_ROOT, assertInside } from "../../paths";
import { publicProcedure, router } from "../init";

const real = notLike(tracks.configPath, "legacy:%");

export const libraryRouter = router({
  albums: publicProcedure.query(({ ctx }) => {
    const rows = ctx.db.select().from(albums).where(eq(albums.archived, false))
      .orderBy(desc(albums.createdAt)).all();
    const exported = ctx.db
      .select({ albumId: tracks.albumId, count: sql<number>`count(*)`.mapWith(Number) })
      .from(tracks).where(eq(tracks.exportStatus, "exported")).groupBy(tracks.albumId).all();
    const exportedBy = new Map(exported.map((row) => [row.albumId, row.count]));
    return rows.map((row) => ({ ...row, exportedCount: exportedBy.get(row.id) ?? 0 }));
  }),

  album: publicProcedure.input(z.object({ id: z.number().int() })).query(({ ctx, input }) => {
    const album = ctx.db.select().from(albums).where(eq(albums.id, input.id)).get();
    if (!album) throw new TRPCError({ code: "NOT_FOUND", message: "找不到专辑" });
    const trackRows = ctx.db.select().from(tracks).where(eq(tracks.albumId, album.id))
      .orderBy(tracks.trackNo).all();
    const ids = trackRows.map((row) => row.id);
    const releaseRows = ids.length
      ? ctx.db.select().from(releases).where(inArray(releases.trackId, ids)).all()
      : [];
    return { album, tracks: trackRows, releases: releaseRows };
  }),

  singles: publicProcedure.query(({ ctx }) => {
    const rows = ctx.db.select().from(tracks).where(and(isNull(tracks.albumId), real))
      .orderBy(desc(tracks.createdAt)).all();
    const ids = rows.map((row) => row.id);
    const releaseRows = ids.length
      ? ctx.db.select().from(releases).where(inArray(releases.trackId, ids)).all()
      : [];
    return { tracks: rows, releases: releaseRows };
  }),

  scan: publicProcedure.query(async ({ ctx }) => {
    const root = PREPARE_ROOT();
    let names: string[];
    try {
      const entries = await readdir(root, { withFileTypes: true });
      names = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const known = new Set(ctx.db.select({ dir: tracks.prepareDir }).from(tracks).all().map((row) => row.dir));
    return names.map((name) => {
      const dir = path.join(root, name);
      return { name, dir, registered: known.has(dir) };
    });
  }),

  register: publicProcedure.input(z.object({ dir: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    const dir = assertInside(PREPARE_ROOT(), input.dir);
    try {
      return await registerPrepareDir(ctx.db, dir, { readTrackNumber, probe: probeAudio });
    } catch (error) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }),

  archive: publicProcedure
    .input(z.object({ id: z.number().int(), archived: z.boolean() }))
    .mutation(({ ctx, input }) => {
      ctx.db.update(albums).set({ archived: input.archived }).where(eq(albums.id, input.id)).run();
      return { ok: true };
    }),
});
```

- [ ] **Step 7: `routers/jobs.ts`**

```ts
import { existsSync } from "node:fs";
import path from "node:path";
import { TRPCError, tracked } from "@trpc/server";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { pollJobChanges, pollLogs } from "../../changes";
import { JOB_KINDS, JOB_STATUSES, jobs } from "../../db/schema";
import { getJob, listLogs, requestCancel, retryJob, enqueueJob } from "../../jobs";
import { planExport } from "../../orchestrate";
import { publicProcedure, router } from "../init";
import { withLabels } from "./labels";

const AUDIO_EXT = new Set([".flac", ".wav", ".m4a", ".mp3", ".ape", ".wv", ".cue", ".ogg", ".opus", ".aac"]);

function fail(error: unknown): never {
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: error instanceof Error ? error.message : String(error),
  });
}

export const jobsRouter = router({
  list: publicProcedure
    .input(z.object({
      status: z.array(z.enum(JOB_STATUSES)).optional(),
      kind: z.enum(JOB_KINDS).optional(),
      albumId: z.number().int().optional(),
      trackId: z.number().int().optional(),
      releaseId: z.string().optional(),
      before: z.number().int().optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }))
    .query(({ ctx, input }) => {
      const rows = ctx.db.select().from(jobs).where(and(
        input.status ? inArray(jobs.status, input.status) : undefined,
        input.kind ? eq(jobs.kind, input.kind) : undefined,
        input.albumId != null ? eq(jobs.albumId, input.albumId) : undefined,
        input.trackId != null ? eq(jobs.trackId, input.trackId) : undefined,
        input.releaseId ? eq(jobs.releaseId, input.releaseId) : undefined,
        input.before != null ? lt(jobs.id, input.before) : undefined,
      )).orderBy(desc(jobs.id)).limit(input.limit).all();
      return {
        rows: withLabels(ctx.db, rows),
        nextBefore: rows.length === input.limit ? rows.at(-1)?.id ?? null : null,
      };
    }),

  get: publicProcedure.input(z.object({ id: z.number().int() })).query(({ ctx, input }) => {
    const job = getJob(ctx.db, input.id);
    if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "找不到任务" });
    const upstream = job.dependsOn.length
      ? ctx.db.select().from(jobs).where(inArray(jobs.id, job.dependsOn)).all()
      : [];
    const downstream = ctx.db.select().from(jobs).where(sql`EXISTS (
      SELECT 1 FROM json_each(${jobs.dependsOn}) AS d WHERE d.value = ${job.id})`).all();
    const [labeled] = withLabels(ctx.db, [job]);
    return { job: labeled!, upstream: withLabels(ctx.db, upstream), downstream: withLabels(ctx.db, downstream) };
  }),

  logs: publicProcedure
    .input(z.object({ id: z.number().int(), afterId: z.number().int().default(0), limit: z.number().int().min(1).max(2000).default(500) }))
    .query(({ ctx, input }) => listLogs(ctx.db, input.id, input.afterId, input.limit)),

  enqueueExport: publicProcedure
    .input(z.object({
      mode: z.enum(["export", "export-then-upload", "export-and-upload"]),
      albumId: z.number().int().optional(),
      trackIds: z.array(z.number().int()).optional(),
      overwriteVideo: z.boolean().optional(),
    }))
    .mutation(({ ctx, input }) => {
      try {
        return planExport(ctx.db, input);
      } catch (error) {
        return fail(error);
      }
    }),

  enqueuePrepare: publicProcedure
    .input(z.object({
      audio: z.string().min(1),
      out: z.string().optional(),
      title: z.string().optional(),
      artist: z.string().optional(),
      album: z.string().optional(),
      lyricOffsetMs: z.number().int().optional(),
      acceptEdgeCredits: z.boolean().optional(),
      lyricFormat: z.enum(["krc", "ttml", "yrc", "qrc", "lys", "lrc"]).optional(),
    }))
    .mutation(({ ctx, input }) => {
      if (!path.isAbsolute(input.audio)) fail(new Error("音频需要绝对路径"));
      if (!existsSync(input.audio)) fail(new Error(`音频不存在: ${input.audio}`));
      if (!AUDIO_EXT.has(path.extname(input.audio).toLowerCase())) {
        fail(new Error("只接受音频文件或 .cue"));
      }
      return enqueueJob(ctx.db, { kind: "prepare", payload: input });
    }),

  cancel: publicProcedure.input(z.object({ id: z.number().int() })).mutation(({ ctx, input }) => ({
    result: requestCancel(ctx.db, input.id, Date.now()),
  })),

  retry: publicProcedure.input(z.object({ id: z.number().int() })).mutation(({ ctx, input }) => {
    try {
      return retryJob(ctx.db, input.id, Date.now());
    } catch (error) {
      return fail(error);
    }
  }),

  /** 只推变化了的任务 id；前端据此让相关查询失效重取。 */
  subscribe: publicProcedure.subscription(async function* ({ ctx, signal }) {
    const stop = signal ?? new AbortController().signal;
    for await (const batch of pollJobChanges(ctx.db, stop, { since: Date.now() })) {
      yield tracked(String(batch.at(-1)?.updatedAt ?? 0), batch.map((row) => row.id));
    }
  }),

  subscribeLogs: publicProcedure
    .input(z.object({ jobId: z.number().int(), afterId: z.number().int().default(0) }))
    .subscription(async function* ({ ctx, input, signal }) {
      const stop = signal ?? new AbortController().signal;
      for await (const rows of pollLogs(ctx.db, input.jobId, input.afterId, stop)) {
        yield tracked(String(rows.at(-1)?.id ?? 0), rows);
      }
    }),
});
```

- [ ] **Step 8: `routers/releases.ts`**

```ts
import { TRPCError } from "@trpc/server";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { fetchDrafts } from "../../bili";
import { jobs, releases } from "../../db/schema";
import { enqueueJob } from "../../jobs";
import { activeReleaseJob, planUpload } from "../../orchestrate";
import { getSettings } from "../../settings";
import { publicProcedure, router } from "../init";

function fail(code: "BAD_REQUEST" | "NOT_FOUND", message: string): never {
  throw new TRPCError({ code, message });
}

export const releasesRouter = router({
  list: publicProcedure
    .input(z.object({ status: z.enum(["pending", "draft", "done"]).optional() }))
    .query(({ ctx, input }) => {
      const rows = (input.status
        ? ctx.db.select().from(releases).where(eq(releases.status, input.status))
        : ctx.db.select().from(releases)).orderBy(desc(releases.createdAt)).all();
      const ids = rows.map((row) => row.id);
      const active = ids.length
        ? ctx.db.select().from(jobs)
          .where(inArray(jobs.releaseId, ids)).orderBy(desc(jobs.id)).all()
        : [];
      return rows.map((row) => ({
        ...row,
        activeJob: active.find((job) =>
          job.releaseId === row.id && ["queued", "running", "cancel_requested"].includes(job.status)) ?? null,
        lastJob: active.find((job) => job.releaseId === row.id) ?? null,
      }));
    }),

  get: publicProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    const row = ctx.db.select().from(releases).where(eq(releases.id, input.id)).get();
    if (!row) fail("NOT_FOUND", "找不到成片");
    return row;
  }),

  updateUpload: publicProcedure
    .input(z.object({
      id: z.string(),
      title: z.string().min(1).optional(),
      desc: z.string().optional(),
      tag: z.string().optional(),
      cover: z.string().optional(),
      tid: z.number().int().optional(),
      copyright: z.union([z.literal(1), z.literal(2)]).optional(),
      dynamic: z.string().optional(),
      hires: z.union([z.literal(0), z.literal(1)]).optional(),
    }))
    .mutation(({ ctx, input }) => {
      const row = ctx.db.select().from(releases).where(eq(releases.id, input.id)).get();
      if (!row) fail("NOT_FOUND", "找不到成片");
      if (row.status !== "pending") fail("BAD_REQUEST", "只有 pending 的成片可以改上传信息");
      if (activeReleaseJob(ctx.db, input.id)) fail("BAD_REQUEST", "这条有进行中的投稿任务，先取消再改");
      const set = {
        ...(input.title !== undefined ? { uploadTitle: input.title } : {}),
        ...(input.desc !== undefined ? { uploadDesc: input.desc } : {}),
        ...(input.tag !== undefined ? { uploadTag: input.tag } : {}),
        ...(input.cover !== undefined ? { uploadCover: input.cover } : {}),
        ...(input.tid !== undefined ? { uploadTid: input.tid } : {}),
        ...(input.copyright !== undefined ? { uploadCopyright: input.copyright } : {}),
        ...(input.dynamic !== undefined ? { uploadDynamic: input.dynamic } : {}),
        ...(input.hires !== undefined ? { uploadHires: input.hires } : {}),
      };
      if (Object.keys(set).length === 0) return row;
      return ctx.db.update(releases).set(set).where(eq(releases.id, input.id)).returning().get();
    }),

  enqueueUpload: publicProcedure
    .input(z.object({ ids: z.array(z.string()).min(1) }))
    .mutation(({ ctx, input }) => {
      try {
        return planUpload(ctx.db, { releaseIds: input.ids });
      } catch (error) {
        return fail("BAD_REQUEST", error instanceof Error ? error.message : String(error));
      }
    }),

  remove: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const row = ctx.db.select().from(releases).where(eq(releases.id, input.id)).get();
    if (!row) fail("NOT_FOUND", "找不到成片");
    if (row.status !== "pending") fail("BAD_REQUEST", "只有 pending 的成片可以删除");
    if (activeReleaseJob(ctx.db, input.id)) fail("BAD_REQUEST", "这条有进行中的投稿任务，先取消");
    ctx.db.delete(releases).where(eq(releases.id, input.id)).run();
    return { ok: true };
  }),

  regenCover: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const row = ctx.db.select().from(releases).where(eq(releases.id, input.id)).get();
    if (!row) fail("NOT_FOUND", "找不到成片");
    if (row.status !== "pending") fail("BAD_REQUEST", "只有 pending 的成片可以重新抽封面");
    if (row.trackId == null) fail("BAD_REQUEST", "这条没有关联曲目");
    return enqueueJob(ctx.db, { kind: "cover", trackId: row.trackId, releaseId: row.id });
  }),

  draftBox: publicProcedure.query(async ({ ctx }) => {
    const capacity = getSettings(ctx.db)["draft.capacity"];
    try {
      const items = await fetchDrafts();
      return { ok: true as const, used: items.length, capacity, items };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error), capacity };
    }
  }),
});
```

- [ ] **Step 9: `routers/seasons.ts`**

```ts
import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { listSeasons } from "../../../../src/release/io";
import { jobs } from "../../db/schema";
import { enqueueJob } from "../../jobs";
import { publicProcedure, router } from "../init";

const ACTIVE = ["queued", "running", "cancel_requested"] as const;

export const seasonsRouter = router({
  list: publicProcedure.query(async () => {
    try {
      return { ok: true as const, seasons: await listSeasons() };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  }),

  ensureForAlbum: publicProcedure.input(z.object({ albumId: z.number().int() })).mutation(({ ctx, input }) => {
    const busy = ctx.db.select({ id: jobs.id }).from(jobs).where(and(
      eq(jobs.kind, "season"), eq(jobs.albumId, input.albumId), inArray(jobs.status, [...ACTIVE]),
    )).get();
    if (busy) throw new TRPCError({ code: "BAD_REQUEST", message: "这张专辑已有进行中的合集任务" });
    return enqueueJob(ctx.db, { kind: "season", albumId: input.albumId });
  }),

  addRelease: publicProcedure.input(z.object({ releaseId: z.string() })).mutation(({ ctx, input }) => {
    const busy = ctx.db.select({ id: jobs.id }).from(jobs).where(and(
      eq(jobs.kind, "season"), eq(jobs.releaseId, input.releaseId), inArray(jobs.status, [...ACTIVE]),
    )).get();
    if (busy) throw new TRPCError({ code: "BAD_REQUEST", message: "这条已有进行中的加入合集任务" });
    return enqueueJob(ctx.db, {
      kind: "season", releaseId: input.releaseId, payload: { releaseId: input.releaseId },
    });
  }),
});
```

- [ ] **Step 10: `routers/history.ts`**

```ts
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { jobs, releases } from "../../db/schema";
import { toShanghaiIso } from "../../time";
import { publicProcedure, router } from "../init";
import { withLabels } from "./labels";

const DAY = 86_400_000;

export const historyRouter = router({
  exports: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }))
    .query(({ ctx, input }) => {
      const rows = ctx.db.select().from(jobs)
        .where(and(eq(jobs.kind, "export"), inArray(jobs.status, ["succeeded", "failed"])))
        .orderBy(desc(jobs.finishedAt)).limit(input.limit).all();
      return withLabels(ctx.db, rows).map((row) => ({
        ...row,
        durationSec: row.startedAt != null && row.finishedAt != null
          ? Math.round((row.finishedAt - row.startedAt) / 1000)
          : null,
        skipped: (row.result as { skipped?: boolean } | null)?.skipped === true,
      }));
    }),

  uploads: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }))
    .query(({ ctx, input }) =>
      ctx.db.select().from(releases).where(eq(releases.status, "done"))
        .orderBy(desc(releases.finishedAt)).limit(input.limit).all()),

  stats: publicProcedure.query(({ ctx }) => {
    const since = Date.now() - 30 * DAY;
    const exported = ctx.db.select().from(jobs).where(and(
      eq(jobs.kind, "export"), eq(jobs.status, "succeeded"), gte(jobs.finishedAt, since),
    )).all();
    const uploaded = ctx.db.select().from(releases).where(and(
      eq(releases.status, "done"), gte(releases.finishedAt, since),
    )).all();
    const days = new Map<string, { day: string; exports: number; uploads: number }>();
    const touch = (at: number) => {
      const day = toShanghaiIso(at).slice(0, 10);
      const entry = days.get(day) ?? { day, exports: 0, uploads: 0 };
      days.set(day, entry);
      return entry;
    };
    for (const row of exported) if (row.finishedAt != null) touch(row.finishedAt).exports += 1;
    for (const row of uploaded) if (row.finishedAt != null) touch(row.finishedAt).uploads += 1;
    const rendered = exported.filter((row) =>
      row.startedAt != null && row.finishedAt != null
      && (row.result as { skipped?: boolean } | null)?.skipped !== true);
    const avgRenderSec = rendered.length
      ? Math.round(rendered.reduce((sum, row) => sum + (row.finishedAt! - row.startedAt!), 0) / rendered.length / 1000)
      : null;
    return { days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)), avgRenderSec };
  }),
});
```

- [ ] **Step 11: `routers/settings.ts`**

```ts
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { settings as settingsTable } from "../../db/schema";
import {
  SETTING_DEFAULTS, SETTING_KEYS, getSettings, resetSettings, settingWarnings, updateSettings,
  type SettingKey, type Settings,
} from "../../settings";
import { publicProcedure, router } from "../init";
import type { Db } from "../../db/client";

function snapshot(db: Db) {
  const values = getSettings(db);
  const updatedAt = Object.fromEntries(
    db.select().from(settingsTable).all().map((row) => [row.key, row.updatedAt]),
  ) as Record<string, number>;
  return { values, defaults: SETTING_DEFAULTS, warnings: settingWarnings(values), updatedAt };
}

export const settingsRouter = router({
  get: publicProcedure.query(({ ctx }) => snapshot(ctx.db)),

  update: publicProcedure.input(z.record(z.string(), z.unknown())).mutation(({ ctx, input }) => {
    try {
      updateSettings(ctx.db, input as Partial<Settings>);
    } catch (error) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return snapshot(ctx.db);
  }),

  reset: publicProcedure
    .input(z.object({ keys: z.array(z.enum(SETTING_KEYS as [SettingKey, ...SettingKey[]])).optional() }))
    .mutation(({ ctx, input }) => {
      resetSettings(ctx.db, input.keys);
      return snapshot(ctx.db);
    }),
});
```

- [ ] **Step 12: `routers/system.ts`**

```ts
import { readFile, statfs } from "node:fs/promises";
import path from "node:path";
import { cookiePath, runCommand } from "../../../../src/release/io";
import { defaultDbFile } from "../../db/client";
import { getSettings } from "../../settings";
import { publicProcedure, router } from "../init";

async function cookieState(): Promise<{ exists: boolean; expiresAt: number | null }> {
  try {
    const data = JSON.parse(await readFile(cookiePath, "utf8")) as {
      cookie_info?: { cookies?: { name: string; expires?: number }[] };
    };
    const session = data.cookie_info?.cookies?.find((cookie) => cookie.name === "SESSDATA");
    return { exists: true, expiresAt: session?.expires ? session.expires * 1000 : null };
  } catch {
    return { exists: false, expiresAt: null };
  }
}

async function whereIs(bin: string): Promise<string | null> {
  try {
    const found = await runCommand(["which", bin]);
    return found.exitCode === 0 ? found.output.trim() : null;
  } catch {
    return null;
  }
}

async function freeBytes(dir: string): Promise<number | null> {
  try {
    const stat = await statfs(dir);
    return Number(stat.bavail) * Number(stat.bsize);
  } catch {
    return null;
  }
}

export const systemRouter = router({
  health: publicProcedure.query(async ({ ctx }) => {
    const settings = getSettings(ctx.db);
    const out = path.join(process.cwd(), "out");
    const [cookies, biliup, ffmpeg, nub, outFree, cwdFree] = await Promise.all([
      cookieState(),
      whereIs(settings["bin.biliup"]),
      whereIs(settings["bin.ffmpeg"]),
      whereIs("nub"),
      freeBytes(out),
      freeBytes(process.cwd()),
    ]);
    return {
      cookies,
      binaries: { biliup, ffmpeg, nub },
      diskFreeBytes: outFree ?? cwdFree,
      dbFile: defaultDbFile(),
    };
  }),
});
```

- [ ] **Step 13: `router.ts`**

```ts
import { createCallerFactory, router } from "./trpc/init";
import { historyRouter } from "./trpc/routers/history";
import { jobsRouter } from "./trpc/routers/jobs";
import { libraryRouter } from "./trpc/routers/library";
import { overviewRouter } from "./trpc/routers/overview";
import { releasesRouter } from "./trpc/routers/releases";
import { seasonsRouter } from "./trpc/routers/seasons";
import { settingsRouter } from "./trpc/routers/settings";
import { systemRouter } from "./trpc/routers/system";

export const appRouter = router({
  overview: overviewRouter,
  library: libraryRouter,
  jobs: jobsRouter,
  releases: releasesRouter,
  seasons: seasonsRouter,
  history: historyRouter,
  settings: settingsRouter,
  system: systemRouter,
});

export type AppRouter = typeof appRouter;
export const createCaller = createCallerFactory(appRouter);
```

- [ ] **Step 14: 跑测试与类型检查**

Run: `node --import ./scripts/register-ts.mjs --test admin/server/router.test.ts`  
Expected: 9 个测试 pass。

Run: `nub exec tsc -p admin`  
Expected: 无输出。常见要调的地方：`z.enum(SETTING_KEYS as [...])` 的元组断言、`.default()` 后输入对象在 `createCaller` 里仍要传 `{}`（测试里已传）。

- [ ] **Step 15: Commit**

```console
git add admin/server/trpc admin/server/router.ts admin/server/router.test.ts
git commit -m ":sparkles: feat(admin): 添加 tRPC 路由，覆盖总览、曲库、任务、投稿、合集、历史、设置和系统状态"
```

---

## Task 15: runner 入口、启动器与整体验证

**Files:**
- Create: `admin/server/runner/main.ts`, `admin/launcher.ts`
- Modify: `AGENTS.md` **不改**，只在最后列出需要用户确认的修改。

**Interfaces:**
- Produces: `nub run admin:runner`（只起 runner）、`nub run admin`（起 web + runner，前端计划完成后才有 web）。

- [ ] **Step 1: 写 `admin/server/runner/main.ts`**

```ts
import { runCommand } from "../../../src/release/io";
import { listDraftIds } from "../bili";
import { bootDb } from "../boot";
import { createIdleHook } from "../idle-scheduler";
import { recoverInterrupted } from "../jobs";
import { executors } from "./executors";
import { parseScreenLocked } from "./idle";
import { createRunner } from "./index";
import { HEARTBEAT_MS, acquireRunnerLock, beat, releaseRunnerLock } from "./lock";

const db = bootDb();
const pid = process.pid;

if (!acquireRunnerLock(db, pid, Date.now())) {
  console.error("已有 runner 在运行，退出");
  process.exit(1);
}
const recovered = recoverInterrupted(db, Date.now());
if (recovered > 0) console.log(`上次退出时有 ${recovered} 个任务还在运行，已标为中断，可在界面里重试`);

const idle = createIdleHook(db, {
  now: Date.now,
  screenLocked: async () => parseScreenLocked((await runCommand(["ioreg", "-n", "Root", "-d1"])).output),
  listDraftIds,
});
const runner = createRunner({ db, executors, onTick: idle });
const heartbeat = setInterval(() => beat(db, pid, Date.now()), HEARTBEAT_MS);
runner.start();
console.log(`runner 已启动 pid=${pid}`);

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  clearInterval(heartbeat);
  console.log("runner 正在停止，在跑的任务会标为中断…");
  await runner.stop();
  releaseRunnerLock(db, pid);
  process.exit(0);
}
process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
```

- [ ] **Step 2: 写 `admin/launcher.ts`**

```ts
import { spawn, type ChildProcess } from "node:child_process";
import { bootDb } from "./server/boot";

// 先在这里迁移并导入旧队列，两个子进程启动时就不会抢着建表。
bootDb();

const children = new Map<string, ChildProcess>();
let closing = false;
let exitCode = 0;

function pipe(name: string, stream: NodeJS.ReadableStream, out: NodeJS.WriteStream): void {
  let tail = "";
  stream.on("data", (chunk: Buffer) => {
    const lines = (tail + chunk.toString()).split("\n");
    tail = lines.pop() ?? "";
    for (const line of lines) out.write(`[${name}] ${line}\n`);
  });
  stream.on("end", () => { if (tail) out.write(`[${name}] ${tail}\n`); });
}

function shutdown(code: number): void {
  if (closing) return;
  closing = true;
  exitCode = code;
  for (const child of children.values()) child.kill("SIGTERM");
  setTimeout(() => {
    for (const child of children.values()) child.kill("SIGKILL");
    process.exit(exitCode);
  }, 10_000).unref();
  if (children.size === 0) process.exit(exitCode);
}

function start(name: string, command: string, args: string[]): void {
  // 不用 detached：终端关闭时子进程跟着退出。
  const child = spawn(command, args, { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  children.set(name, child);
  pipe(name, child.stdout, process.stdout);
  pipe(name, child.stderr, process.stderr);
  child.on("exit", (code) => {
    children.delete(name);
    console.log(`[${name}] 已退出 (${code ?? "signal"})`);
    shutdown(code ?? 1);
    if (closing && children.size === 0) process.exit(exitCode);
  });
}

start("runner", "nub", ["admin/server/runner/main.ts"]);
start("web", "nub", ["exec", "vite", "dev"]);
console.log("管理后台 http://127.0.0.1:3100 （Ctrl-C 停止，在跑的任务会标为中断）");

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
```

- [ ] **Step 3: 全量测试、类型检查、lint**

Run: `node --import ./scripts/register-ts.mjs --test src/**/*.test.ts admin/**/*.test.ts`  
Expected: 全部 pass，没有 fail。

Run: `nub exec tsc && nub exec tsc -p admin && nub exec eslint src`  
Expected: 无输出。

- [ ] **Step 4: runner 冒烟：真实执行器 + 真实子进程（用内存库，不碰 `data/`）**

新建 `tmp/admin-smoke.ts`（`tmp/` 被 git 忽略，不提交）：

```ts
import { openDb } from "../admin/server/db/client";
import { enqueueJob, getJob, listLogs } from "../admin/server/jobs";
import { createRunner } from "../admin/server/runner";
import { executors } from "../admin/server/runner/executors";

const db = openDb(":memory:");
const job = enqueueJob(db, { kind: "prepare", payload: { audio: "/nonexistent/a.flac" } });
const runner = createRunner({ db, executors, pollMs: 200 });
runner.start();
const deadline = Date.now() + 60_000;
while (Date.now() < deadline && !["failed", "succeeded"].includes(getJob(db, job.id)?.status ?? "")) {
  await new Promise((resolve) => setTimeout(resolve, 300));
}
await runner.stop();
console.log(getJob(db, job.id)?.status, getJob(db, job.id)?.error);
console.log(listLogs(db, job.id, 0).map((row) => row.line).join("\n"));
```

Run: `nub tmp/admin-smoke.ts`  
Expected: 第一行 `failed 备料退出码 1 …`，下面是备料 CLI 对「文件不存在」的报错输出（说明 runner 领取、执行器 spawn、逐行日志、失败收尾整条链是通的）。

- [ ] **Step 5: runner 进程冒烟（用临时库）**

> 警告：`bootDb()` 会把当前目录下的 `tmp/upload-queue.json` 导入并改名为 `.imported`。在仓库根目录跑这一步会把真实队列导进临时库。必须先 `mkdir -p /tmp/smoke/tmp && cd /tmp/smoke`，再用绝对路径起 runner：`RMV_DB=/tmp/smoke/s.db nub /Volumes/M1T/workspace/rmv/admin/server/runner/main.ts`。

Run: `RMV_DB=/tmp/smoke/s.db nub <仓库>/admin/server/runner/main.ts`（前台，几秒后 Ctrl-C）  
Expected: 打印 `runner 已启动 pid=…`；Ctrl-C 后打印 `runner 正在停止…` 并正常退出。另开终端再起一个同样的命令，应打印 `已有 runner 在运行，退出`。结束后 `rm /tmp/rmv-smoke.db*`。

- [ ] **Step 6:（需要用户明确同意才做）真实草稿发布验证**

`publish_draft` 执行器依赖的 B 站草稿接口返回无法离线验证。只有用户明确说「现在发布草稿 <id>」时：在界面（前端计划完成后）或 `tmp` 脚本里对那一条入队 `publish_draft`，观察日志。如果 `add/v3` 返回非 0，按返回的 `message` 调整 `buildPublishBody` 的字段并补测试；草稿在失败时原样保留，可以反复试。成功后确认草稿箱里那条已被删除、数据库里 `releases` 变成 `done` 并有 `bvid`。

- [ ] **Step 7: Commit**

```console
git add admin/server/runner/main.ts admin/launcher.ts
git commit -m ":sparkles: feat(admin): 添加 runner 入口和一条命令启动 web 与 runner 的启动器"
```

---

## 需要用户确认的 AGENTS.md 修改（计划不自动改）

`tmp/upload-queue.json` 不再是队列的事实来源，数据库 `data/rmv.db` 取代它。下面这些 AGENTS.md 里的条款要相应调整，**等用户确认后再改**：

1. 「成片先入队」「空闲再传」「两种投稿」「草稿」里所有 `tmp/upload-queue.json` 的写法，改成「数据库 `data/rmv.db` 的 `releases` 表（`nub run release` 与管理后台共用）」。条目字段名不变（`id`、`mode`、`status`、`video`、`title`、`created`、`bvid`、`draft_id`、`hold_until`、`locked_since`）。
2. 「队列文件不存在时建成 `{ locked_since, hold_until, items }`」改成「数据库首次打开时自动迁移；旧的 `tmp/upload-queue.json` 一次性导入后改名为 `.imported`」。
3. 「空闲再传」目前写的是靠人/代理在对话里触发。管理后台的 runner 常驻时由它按同一套规则（凌晨 00:00–05:59，或锁屏满 10 分钟；先草稿后 pending；一次一条；间隔 180 秒；`hold_until`）自动执行，阈值可在设置里改，偏离默认值会警告。建议加一句「runner 在线时由它负责空闲再传；runner 不在线时仍按本节规则手动处理」。
4. 「空闲再传」里「一次只传一条」在 runner 里由 `bili.maxParallel = 1` 保证；这个设置大于 1 时界面会警告，规则不变。
5. `.agents/skills/single-track-batch/SKILL.md` 里如果提到直接读写 `tmp/upload-queue.json`，同样改成走 `nub run release` 或管理后台。
