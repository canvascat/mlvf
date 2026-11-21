# 视频导出与发布后台

日期：2026-11-21  
状态：待实现

在本机提供一个 Web 后台，管理备料、导出、投稿、历史记录。数据库取代 `tmp/upload-queue.json`，`nub run release` 改为读写数据库。

## 目标

- 在界面上登记素材（专辑、单曲）、触发备料、创建导出任务、查看进度和实时日志、取消和重试。
- 在界面上管理发布队列：编辑投稿信息、手动立即上传、草稿箱、合集、限流状态。
- 查看导出和投稿的历史、失败原因、BV 链接。
- 空闲自动投稿（`AGENTS.md` 的夜间和锁屏规则）由后台服务执行。
- 并行数、间隔、空闲窗口等都可在界面配置，改完立即生效。
- 投稿间隔、限流、草稿、Hi-Res、动态和合集写操作遵守 `AGENTS.md`。
- 导出和投稿在前台终端里跑，终端结束时 Chrome 和 biliup 一起退出。

## 非目标

- 多用户、登录、远程访问。服务只监听 `127.0.0.1`。
- 不改渲染参数（`--gl=angle`、`headless-shell`、`--timeout`），不改备料规则，不改 `album-preview`。
- 本次不把渲染改成 `renderMedia` API，导出执行器留好边界，之后只换其内部。
- 不自动改写 `AGENTS.md`。实现时列出需要改的规则，由用户确认。
- 界面不做端到端自动化测试。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | TanStack Start（React 19）、Router、Query、Table |
| UI | shadcn/ui、Tailwind v4、lucide、sonner |
| 通信 | tRPC v11（`@trpc/tanstack-react-query`），transformer 用 superjson，实时更新用 SSE 订阅 |
| 校验 | zod 4 |
| 数据库 | `node:sqlite`，WAL 模式 |
| ORM | `drizzle-orm@1.0.0-rc` 的 `drizzle-orm/node-sqlite` 驱动，`drizzle-kit` 管迁移 |

Drizzle 稳定版 0.45 没有 `node:sqlite` 驱动，1.0 rc 才有，所以锁定 rc 版本，升级前先确认 API 变化。

## 架构

`nub run admin` 在前台拉起三个进程，只通过同一个 SQLite 文件交流：

```
nub run admin   启动器：拉起子进程、转发日志、Ctrl+C 时一起退出
 ├─ web      TanStack Start：界面 + tRPC（127.0.0.1）
 └─ runner   任务执行器：领取任务、导出、投稿、空闲调度
```

- web 往 `jobs` 表写任务，runner 领取并执行，进度和日志写回数据库，web 通过 SSE 推给界面。
- 这样改 web 代码触发重启时，正在渲染的任务不受影响。
- `startRunner({ db })` 是进程无关的入口。环境变量 `ADMIN_RUNNER=process|embedded` 决定它跑在独立子进程（默认）还是 web 进程内。表结构、tRPC 接口和界面不随之变化，稳定后可切到 `embedded`。
- 命令：`nub run admin` 启动全部；`admin:web`、`admin:runner` 可单独启动。

### 目录

```
admin/
  app/                 routes、components、tRPC client
  server/
    db/                schema、迁移、连接
    trpc/              各 router
    runner/            startRunner、调度、执行器
    services/          bili（合集、草稿、投稿）、prepare、export 的薄封装
  launcher.ts
data/rmv.db            数据库文件，加入 .gitignore
```

runner 通过相对路径复用 `src/export`、`src/release`、`src/prepare`。`admin/` 与 Remotion 的 `src/` 分开，不影响 `remotion bundle` 和 `eslint src`。

## 数据模型

时间统一存毫秒时间戳。

```
albums 1 ──< tracks 1 ──0..1 releases
   │                          ▲
   └──────── 0..1 ────────────┘   整张专辑的成片（如整轨 CUE 视频）
jobs ──> albums / tracks / releases（都可空）
```

| 表 | 作用 | 关键字段 |
| --- | --- | --- |
| `albums` | 专辑 | `id`、`prepare_dir`（唯一）、`title`、`artist`、`year`、`genre`、`cover_path`、`track_count`、`season_id`、`section_id`、`created_at` |
| `tracks` | 每首歌，包括单曲 | `id`、`album_id`（可空，单曲为空）、`track_no`、`prepare_dir`、`config_path`（唯一）、`audio_path`、`lyric_path`、`cover_path`、`title`、`artist`、`composer`、`year`、`genre`、`duration_sec`、`lyric_source`、`lyric_format`、`lyric_offset_ms`、`album_title`、`audio_sample_rate`、`audio_bits`、`audio_lossless`、`export_status`（none、exported、failed） |
| `releases` | 一个待发布的成片，对应原队列的一条 | `id`、`track_id`（可空）、`album_id`（可空）、`mode`（first、overwrite）、`status`（pending、draft、done）、`video`（唯一）、`title`（分 P 标题）、`bvid`、`draft_id`、`season_id`、`section_id`、`season_added`、`created_at`、`finished_at`；投稿快照 `upload_title`、`upload_desc`、`upload_tag`、`upload_cover`、`upload_tid`、`upload_copyright`、`upload_dynamic`、`upload_hires` |
| `jobs` | 一次任务执行 | `kind`、`lane`、`status`、`album_id`、`track_id`、`release_id`、`depends_on`（JSON 数组）、`payload`、`progress`（0 到 1）、`result`、`error`、`attempt`、`run_after`、`retry_of`、`created_at`、`updated_at`、`started_at`、`finished_at` |
| `job_logs` | 任务日志 | `job_id`、`ts`、`stream`（stdout、stderr、system）、`line` |
| `runner_state` | 单行状态 | `locked_since`、`hold_until`、`last_upload_ok_at`、`pid`、`heartbeat_at` |
| `settings` | 键值配置 | `key`、`value`（JSON）、`updated_at` |

### 关联规则

- 专辑里的歌：`tracks.album_id` 指向 `albums.id`。删除专辑不级联删歌曲，界面上做归档。
- 单曲：`tracks.album_id` 为空，`prepare_dir` 和 `config_path` 记在曲目自己身上。
- 单首成片：`releases.track_id` 有值，`album_id` 为空。整张专辑的成片：`album_id` 有值，`track_id` 为空。两者有且只有一个有值，用 `CHECK` 约束保证。
- 合集 `season_id`、`section_id` 放在 `albums`。单曲不入专辑合集。
- 「整张专辑只带一条动态」：看该专辑下曲序最小那首 `releases` 的 `dynamic`。
- `releases.video` 唯一。同一成片已有 `pending` 时更新原条，已是 `done` 或 `draft` 的不重置。
- `releases.status` 沿用 `AGENTS.md` 的三态。失败信息只放在 `jobs`。

### 任务

种类：`prepare`、`export`、`cover`、`season`、`upload`（新投和覆盖共用，按 `releases.mode` 分流）、`publish_draft`。草稿由 `upload` 任务在限流降级时直接存入，不单设种类。

状态：`queued`、`running`、`succeeded`、`failed`、`cancel_requested`、`cancelled`、`interrupted`。

重试新建一条 `jobs`，`retry_of` 指回原任务，每次尝试都留在历史里。导出历史和投稿历史是对 `jobs` 按 `kind` 的查询，再连上 `albums`、`tracks`、`releases`，没有单独的历史表。

日志入库前把 cookie、`csrf`、`access_key` 等替换成 `***`。每个任务保留最近 `log.maxLinesPerJob` 行。

### 一次性迁移

首次启动把 `tmp/upload-queue.json` 导入 `releases`，在一个事务里完成，以 `id` 去重，可重复执行。

- 每条按成片路径反查对应 `tracks`。查不到的（例如旧的覆盖稿）建一条只有路径和标题的 `tracks` 占位，保证每条 `releases` 都能关联到曲目。
- `locked_since`、`hold_until` 写入 `runner_state`。
- 成功后原文件改名为 `upload-queue.json.imported`。失败整体回滚，原文件不动。
- `src/release/io.ts` 的 `loadQueue`、`saveQueue` 改为读写数据库，`release` 命令行为不变。
- `AGENTS.md` 里写入 `tmp/upload-queue.json` 的规则需同步改成写入数据库，实现时列出改动由用户确认。

## runner

### 通道

两条通道，各自串行，互相并行：

| lane | 任务种类 | 默认并行 |
| --- | --- | --- |
| `render` | `prepare`、`export`、`cover` | 1 |
| `bili` | `season`、`upload`、`publish_draft` | 1 |

runner 只领取「依赖都已成功、`run_after` 已到」的任务，领取用一条原子语句：`UPDATE jobs SET status='running' ... WHERE id = (SELECT ... ORDER BY id LIMIT 1) RETURNING *`。

### 批量编排

用依赖表达，不靠内存状态：

- `export-then-upload`：每首的 `upload` 依赖本批所有 `export`，并依赖上一首的 `upload`。
- `export-and-upload`：每首的 `upload` 只依赖自己那首的 `export` 和上一首的 `upload`。投稿等待间隔时，`render` lane 继续导出下一首。
- 某首导出失败，依赖它的任务标成 `cancelled`（原因「依赖失败」）。`export-and-upload` 里已经入队、不依赖它的投稿继续跑。
- 曲序读音频的 `track` 标签，从小到大；没有标签时按 json 文件名的 `zh-Hans` 排序。

### 执行器

每种 `kind` 一个执行器：`run(job, ctx) → result`。`ctx` 提供写日志、报进度、`signal`（取消）、读写数据库。执行器可注入，调度用假执行器测。

导出继续调用现有 `exportVideo`，只改三处：

- `runRemotion` 不再 `stdio: "inherit"`，接管 stdout 和 stderr，逐行写入 `job_logs`，并解析 `Rendered x/y` 报进度。
- 接收 `AbortSignal`，取消时对 `remotion` 子进程发 `SIGTERM`，由它自己收掉 Chrome。
- 不使用 `detached`，前台终端关闭时子进程跟着退出。runner 退出时兜底杀掉自己启动的子进程。

投稿复用 `upload-one.ts`、`season.ts`、`upload-result.ts`，数据读写从 JSON 换成数据库。

### 限流和重试

- `21566`：`upload` 任务在任务内部等待 `retry.rateLimitWaitSec`（可取消的等待，任务保持 `running`），再重试同一条。这期间 `bili` lane 被它占着，不会领取其他投稿任务；这正是 AGENTS.md 要的串行。
- `137022`，或已隔够间隔后仍返回 `21566`、`137022`、「投稿过于频繁」：`upload` 任务把这一条存草稿并以失败结束，依赖它的后续投稿因此被级联取消，即停止该批后续投稿。覆盖稿不走草稿，`hold_until` 写成次日 00:00，其余覆盖留在队列。
- 草稿箱先 `GET /x/vupre/web/draft/list?pn=1&ps=30`，空位是 `draft.capacity - 已有条数`；空位为 0 时一条都不存，剩余留在队列并在结果里写明。不删已有草稿。
- 合集和草稿的写操作共用一个节流器，间隔 `season.writeIntervalSec`。`20111`、`256000` 等 `retry.editBusyWaitSec` 后重试同一次。新稿件加合集返回 `-404` 或「啥都木有」时等 `retry.notFoundWaitSec` 重试同一次。
- 启动投稿前若已有 `biliup upload` 进程或另一次投稿在跑，直接失败，不并行传。
- 登录态：上传任务启动前检查 `cookies.json`，失效则直接 `failed` 并说明，不触发投稿。

### 空闲调度

runner 每 `idle.tickSec` 秒检查一次。`idle.enabled` 开启、`hold_until` 已过，并满足下列任一条件时入队：本地时间在 `idle.nightStartHour` 到 `idle.nightEndHour` 之间，或屏幕已连续锁定满 `idle.lockMinutes` 分钟。

- 锁屏看 `ioreg -n Root -d1` 里有没有 `CGSSessionScreenIsLocked` 且值为 `Yes`。第一次发现锁定只写 `locked_since`；下次仍锁定且已满时长再传；解锁后清成 `null`。
- 入队顺序：先 `publish_draft`，再 `pending` 的投稿；队列里 `draft` 的按 `created_at`，接着是草稿箱里数据库没记下的。
- 发布草稿时再次返回投稿过于频繁，本次空闲停止，剩余草稿留在草稿箱，`pending` 不接着传。
- 界面「立即上传」绕过空闲条件和 `hold_until`，不绕过投稿间隔。

### 存活与恢复

- runner 每 5 秒写 `heartbeat_at`，界面据此显示在线或离线。
- 启动时发现 `running` 的任务，一律改成 `interrupted`，关联的 `releases` 保持原状态，等用户在界面重试。
- 启动器收到 Ctrl+C，向 web 和 runner 发 `SIGTERM`；runner 先把在跑的任务标成 `interrupted` 再退出。
- 已有活着的 runner（`heartbeat` 新鲜且 `pid` 存在）时，新的 runner 直接退出。

## 可配置项

存在 `settings` 表，界面「设置」页修改，runner 每个 tick 重新读取，改完立即生效。默认值取自 `AGENTS.md`，偏离默认值时界面给出警告，每项用 zod 校验范围，非法值保存时直接拒绝。

| 分组 | 配置项 | 默认值 | 说明 |
| --- | --- | --- | --- |
| 并行 | `render.maxParallel` | 1 | 同时导出的任务数，范围 1 到 8，大于 1 时提示内存和 Chrome 占用 |
| 并行 | `render.frameConcurrency` | 1 | 传给 `remotion --concurrency`，接受数字或 `50%`，与 `exportVideo` 现有默认一致 |
| 并行 | `bili.maxParallel` | 1 | 同时投稿的任务数，范围 1 到 8，大于 1 时警告容易触发 21566 |
| 间隔 | `upload.minIntervalSec` | 180 | 从上一次成功投稿起算到下一次投稿开始，低于 180 时警告 |
| 间隔 | `season.writeIntervalSec` | 3 | 合集和草稿写操作之间 |
| 间隔 | `retry.rateLimitWaitSec` | 180 | 21566 后等待 |
| 间隔 | `retry.editBusyWaitSec` | 20 | 20111、256000 后等待 |
| 间隔 | `retry.notFoundWaitSec` | 30 | 新稿件加合集 `-404` 后等待 |
| 空闲 | `idle.enabled` | 开 | 关掉后只有手动上传 |
| 空闲 | `idle.nightStartHour`、`idle.nightEndHour` | 0、6 | 夜间窗口，本地时间 |
| 空闲 | `idle.lockMinutes` | 10 | 锁屏连续多久算空闲 |
| 空闲 | `idle.tickSec` | 60 | 调度检查周期 |
| 草稿 | `draft.capacity` | 30 | 草稿箱上限 |
| 日志 | `log.maxLinesPerJob` | 5000 | 每个任务保留的日志行数 |
| 路径 | `bin.biliup`、`bin.ffmpeg` | `biliup`、`ffmpeg` | 可执行文件路径 |

`upload.minIntervalSec` 的语义保持「上一次成功之后再等」，所以 `bili.maxParallel` 大于 1 时，只有间隔设得很小才会真正重叠。合集和草稿的写操作无论投稿并行数多少，都共用同一个节流器。

## tRPC 接口

| router | 过程 |
| --- | --- |
| `overview` | `get`：runner 状态和心跳、两条 lane 当前任务和进度、队列计数、空闲状态、`hold_until` |
| `library` | `albums.list/get`、`tracks.list/get`（可筛单曲）、`scanPrepareDirs`（扫描 `预处理/`）、`register` |
| `jobs` | `list`（按种类、状态、专辑、曲目、时间筛选，分页）、`get`、`logs(jobId, afterId)`、`enqueueExport`、`enqueuePrepare`、`cancel`、`retry`、`subscribe`（SSE） |
| `releases` | `list`、`get`、`updateUpload`（仅 `pending`）、`enqueueUpload({ids, now})`、`publishDraft`、`remove`（仅 `pending`）、`regenCover`、`draftBox` |
| `seasons` | `list`、`ensureForAlbum`、`addToSection` |
| `history` | `exports`、`uploads`（日期、状态、关键字、专辑筛选）、`stats`（按天数量和成功率） |
| `settings` | `get`、`update`、`reset` |
| `system` | `health`：biliup 登录态、`ffmpeg` 和 `biliup` 是否可用、`out/` 剩余空间 |

`jobs.enqueueExport` 的入参含 `mode`（`export`、`export-then-upload`、`export-and-upload`）、目标（专辑或曲目 id 列表）、`overwriteVideo`，在一个事务里建好任务和依赖。所有入参用 zod 校验。

`jobs.subscribe` 由 web 进程每秒查一次 `updated_at` 大于游标的任务和日志，有变化就推送。客户端更新 TanStack Query 缓存，SSE 断开时退回每 2 秒轮询。

## 界面

| 路由 | 内容 |
| --- | --- |
| `/` 概览 | runner 在线状态；`render` 和 `bili` 两条 lane 当前任务和进度条；待传、草稿、完成统计；最近失败；限流或 `hold_until` 横幅；登录态失效提示 |
| `/library` | 「专辑」「单曲」两个 Tab；表格含歌手、曲目数、导出状态、合集；「备料」按钮，选目录运行 `prepare` 并看日志 |
| `/library/albums/$id` | 曲目表（歌词来源和质量、Hi-Res 判定、导出状态）、合集信息；批量按钮：导出、导出后上传、导出并上传、重导 |
| `/jobs`、`/jobs/$id` | 任务表加筛选；详情含状态、参数、进度、实时日志（虚拟滚动）、取消、重试、重试链 |
| `/releases` | pending、draft、done 三个 Tab；侧边抽屉编辑上传信息；「立即上传」；草稿箱 `已用/30`；限流横幅 |
| `/history` | 导出历史、投稿历史两个 Tab；BV 链接、失败原因、耗时、产物大小；按天趋势小图 |
| `/settings` | 上表所有配置，分组表单，偏离默认值警告，「恢复默认」 |

组件：shadcn 的 Sidebar、Table（配 TanStack Table）、Tabs、Sheet、Dialog、Badge、Progress、Form、Sonner、Alert。

### 安全

- 服务只监听 `127.0.0.1`。
- 接收路径的接口只允许落在 `预处理/`、`out/`、`tmp/` 下。
- 覆盖已有 mkv、立即上传、批量重导都有确认对话框，并显示影响条数。

## 错误处理

| 场景 | 处理 |
| --- | --- |
| 导出子进程非 0 退出 | 任务 `failed`，错误取日志末尾若干行，`tracks.export_status` 写 `failed`，可一键重试 |
| 成片、封面、备料目录不存在 | 任务启动时先校验路径，失败给出具体路径，不进入渲染 |
| 草稿箱已满 | 一条都不存，剩余留在队列，结果和横幅里写明差几条 |
| runner 崩溃或 Ctrl+C | 重启后 `running` 变 `interrupted`，`releases` 状态不变 |
| 迁移失败 | 启动器退出并打印原因，不启动 web 和 runner |
| tRPC 参数不合法 | zod 拒绝，表单展示字段级错误 |

## 测试

沿用现有 `*.test.ts` 方式。不在测试里真的渲染或投稿。

- 调度：假执行器测依赖编排、两条 lane 互不阻塞、取消传播、依赖失败后的 `cancelled`。
- 限流与间隔：假时钟测 `21566` 重试同一条、间隔等待、`hold_until`、草稿降级、草稿空位为 0。
- 配置：非法值被拒绝，设置热更新生效。
- 迁移：用现有 `tmp/upload-queue.json` 的副本做夹具，测导入幂等、占位 `tracks`、失败回滚。
- 仓储：内存 SQLite 测 `CHECK` 约束、`releases.video` 唯一、原子领取只会被一个调用者拿到。
- 集成：用 tRPC `createCaller` 加假执行器，跑通「创建导出、状态变化、历史可查」。
- 回归：`src/release` 原有测试在改读写数据库后保持通过。
- 界面：实现完成后浏览器手动走一遍主流程并截图。
