# 管理后台（前端）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**前置:** 后端计划 `docs/superpowers/plans/2026-11-21-admin-console-backend.md` 全部完成（本计划消费它导出的 `AppRouter`）。

**Goal:** 做出管理后台的界面：总览、曲库（专辑/单曲/备料目录）、任务（实时日志）、投稿（编辑上传信息、草稿箱）、历史、设置。

**Architecture:** TanStack Start（`srcDirectory: "admin/app"`，只在本机 `127.0.0.1:3100` 起）提供页面和 `/api/trpc`。页面全部走客户端取数：`@trpc/tanstack-react-query` + TanStack Query。`jobs.subscribe`（SSE）只通知「有任务变了」，前端据此让相关查询失效重取，不在前端手工合并状态。UI 用 shadcn/ui（radix-nova）+ Tailwind v4，表格用 TanStack Table。

**Tech Stack:** `@tanstack/react-start`、`@tanstack/react-router`、`@tanstack/react-query`、`@tanstack/react-table`、`@trpc/client`、`@trpc/tanstack-react-query`、shadcn/ui、Tailwind v4、Vite 8、lucide-react。

**Spec:** `docs/superpowers/specs/2026-11-21-admin-console-design.md`

## Global Constraints

- 命令在 Cursor 内置终端前台跑，不用 `nohup`、`disown`、`&`。看页面时 `nub run admin` 前台起，Ctrl-C 结束。
- 保持项目已有的 `react` / `react-dom` 版本（`19.2.3`，Remotion 同版），不要为了前端升级它们。
- 界面文案全部简体中文。
- 前端只 `import type` 服务端代码（`AppRouter`），不得 import `admin/server/**` 的运行时代码。
- 危险操作（取消在跑的任务、导出并上传、删除成片、重置设置）必须二次确认。
- 偏离 AGENTS.md 默认节奏的设置要有可见警告，不拦截。
- 路径类输入由服务端白名单校验，前端只做提示。
- 提交说明用 `:<gitmoji>: <type>(admin): <简体中文>`。
- Remotion 的 AGENTS 样式约定只适用于 Remotion 组件；管理后台用 Tailwind 类和 shadcn 组件，不受 `Interactive.*` 规则约束。

## 路由树

TanStack Start 在 `vite dev` 启动和路由文件变化时重新生成 `admin/app/routeTree.gen.ts`。Task 3 会一次性建好全部页面的占位路由并生成路由树，之后各任务只改页面内容，路径不变，不需要再生成。只有新增、改名路由文件时才需要重新生成：没有常驻 dev 服务时用 Task 1 Step 7 的一次性命令（起服务、等 10 秒、杀掉）；已经在另一个终端前台跑着 `nub run admin:web` 时它会自动更新。`routeTree.gen.ts` 要提交。

## File Structure

```text
vite.config.ts
components.json                    shadcn 生成
admin/app/
  router.tsx                       路由 + tRPC/Query 客户端
  routeTree.gen.ts                 生成，提交
  styles.css                       shadcn 生成的主题
  lib/{trpc,format,utils}.ts
  hooks/use-job-stream.ts
  components/
    app-shell.tsx  data-table.tsx  status.tsx  confirm-button.tsx  progress-cell.tsx
    prepare-dialog.tsx  export-actions.tsx  release-sheet.tsx
    ui/                            shadcn 生成
  routes/
    __root.tsx  index.tsx
    api/trpc.$.ts
    library.index.tsx  library.albums.$id.tsx
    jobs.index.tsx  jobs.$id.tsx
    releases.tsx  history.tsx  settings.tsx
```

---

## Task 1: Start 脚手架与 tRPC 接入

**Files:**
- Create: `vite.config.ts`, `admin/app/router.tsx`, `admin/app/lib/trpc.ts`, `admin/app/routes/__root.tsx`, `admin/app/routes/index.tsx`, `admin/app/routes/api/trpc.$.ts`
- Modify: `package.json`, `admin/tsconfig.json`

- [ ] **Step 1: 安装依赖**

```console
nub add @tanstack/react-start @tanstack/react-router @tanstack/react-query @tanstack/react-table @trpc/client@11.29.5 @trpc/tanstack-react-query@11.29.5 lucide-react
nub add -D vite @vitejs/plugin-react tailwindcss @tailwindcss/vite @types/react-dom
```

Expected: 安装成功；`react`、`react-dom` 版本不变（仍是 19.2.3）。如果 peer 依赖提示要求更高的 React，停下来问用户，不要自行升级。

- [ ] **Step 2: `vite.config.ts`**

```ts
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  server: { host: "127.0.0.1", port: 3100 },
  resolve: { tsconfigPaths: true },
  plugins: [tanstackStart({ srcDirectory: "admin/app" }), viteReact(), tailwindcss()],
});
```

- [ ] **Step 3: `admin/tsconfig.json` 把 `vite/client` 加回 `types`**

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": { "types": ["node", "vite/client"] },
  "include": ["./**/*", "../vite.config.ts", "../drizzle.config.ts"],
  "exclude": ["./**/node_modules"]
}
```

- [ ] **Step 4: `admin/app/lib/trpc.ts`**

```ts
import { createTRPCContext } from "@trpc/tanstack-react-query";
import type { AppRouter } from "../../server/router";

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();
```

- [ ] **Step 5: `admin/app/router.tsx`**

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { createTRPCClient, httpBatchLink, httpSubscriptionLink, splitLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../server/router";
import { TRPCProvider } from "./lib/trpc";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 5000, refetchOnWindowFocus: true } },
  });
  const trpcClient = createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (op) => op.type === "subscription",
        true: httpSubscriptionLink({ url: "/api/trpc", transformer: superjson }),
        false: httpBatchLink({ url: "/api/trpc", transformer: superjson }),
      }),
    ],
  });
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    Wrap: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
          {children}
        </TRPCProvider>
      </QueryClientProvider>
    ),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
```

- [ ] **Step 6: 路由占位与 tRPC 挂载**

`admin/app/routes/__root.tsx`：

```tsx
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";

export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: "utf-8" }, { name: "viewport", content: "width=device-width, initial-scale=1" }, { title: "rmv 管理后台" }],
  }),
  component: () => (
    <html lang="zh-CN">
      <head><HeadContent /></head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  ),
});
```

`admin/app/routes/index.tsx`：

```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: () => <h1>rmv 管理后台</h1> });
```

`admin/app/routes/api/trpc.$.ts`：

```ts
import { createFileRoute } from "@tanstack/react-router";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "../../../server/router";
import { createContext } from "../../../server/trpc/context";

const handle = ({ request }: { request: Request }) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext: () => createContext(),
  });

export const Route = createFileRoute("/api/trpc/$")({
  server: { handlers: { GET: handle, POST: handle } },
});
```

- [ ] **Step 7: 起一次服务，确认 tRPC 通，并生成路由树**

用 AGENTS.md 里的长时间导出规则不适用于这里：这是一次性的「起服务、请求、立刻杀掉」冒烟，不留后台进程。起、请求、杀要在同一条命令里完成（shell 调用结束时后台进程会被杀）：

```console
(RMV_DB=/tmp/rmv-fe.db nub exec vite dev > /tmp/vite-smoke.log 2>&1 & echo $! > /tmp/vite-smoke.pid); sleep 10; curl -s 'http://127.0.0.1:3100/api/trpc/overview.get'; pkill -P "$(cat /tmp/vite-smoke.pid)"; kill "$(cat /tmp/vite-smoke.pid)"; rm -f /tmp/vite-smoke.pid
```

Expected: `curl` 返回 JSON，包含 `"runner":{"online":false`（superjson 外壳 `{"result":{"data":{"json":{...}}}}`）。首次启动会生成 `admin/app/routeTree.gen.ts`。如果返回为空，看 `/tmp/vite-smoke.log`。

- [ ] **Step 8: 类型检查**

Run: `nub exec tsc -p admin`  
Expected: 无输出。

- [ ] **Step 9: Commit**

```console
git add package.json nub.lock vite.config.ts admin/tsconfig.json admin/app
git commit -m ":sparkles: feat(admin): 接入 TanStack Start 和 tRPC，提供 /api/trpc"
```

---

## Task 2: shadcn/ui 与工具函数

**Files:**
- Create: `components.json`, `admin/app/styles.css`, `admin/app/lib/utils.ts`, `admin/app/components/ui/*`（生成）, `admin/app/lib/format.ts`
- Test: `admin/app/lib/format.test.ts`
- Modify: `admin/app/routes/__root.tsx`

- [ ] **Step 1: 初始化 shadcn**

```console
nub x shadcn@latest init -p nova -y
```

Expected: 生成 `components.json`（`style: "radix-nova"`，`css: "admin/app/styles.css"`，别名 `@/components`、`@/lib/utils`），`admin/app/styles.css`，`admin/app/lib/utils.ts`。如果它提示找不到路径别名，确认根 `tsconfig.json` 里有 `"paths": { "@/*": ["./admin/app/*"] }`（后端计划 Task 0 已加）。

- [ ] **Step 2: 添加组件**

```console
nub x shadcn@latest add button card badge table tabs dialog sheet input textarea label select checkbox switch progress alert alert-dialog scroll-area separator skeleton sonner tooltip sidebar -y
```

Expected: `admin/app/components/ui/` 下出现对应文件。

- [ ] **Step 3: `__root.tsx` 引入样式和 Toaster**

```tsx
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: "utf-8" }, { name: "viewport", content: "width=device-width, initial-scale=1" }, { title: "rmv 管理后台" }],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: () => (
    <html lang="zh-CN">
      <head><HeadContent /></head>
      <body>
        <Outlet />
        <Toaster richColors />
        <Scripts />
      </body>
    </html>
  ),
});
```

- [ ] **Step 4: 测试 `admin/app/lib/format.test.ts`**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatBytes, formatDuration, formatTime, jobKindLabel, jobStatusLabel } from "./format";

test("时长按有无小时显示", () => {
  assert.equal(formatDuration(65), "1:05");
  assert.equal(formatDuration(3725), "1:02:05");
  assert.equal(formatDuration(null), "—");
});

test("字节数用合适单位", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(5 * 1024 ** 3), "5.0 GB");
  assert.equal(formatBytes(null), "—");
});

test("时间固定按上海时区显示", () => {
  assert.equal(formatTime(Date.UTC(2026, 10, 21, 16, 5, 9)), "2026-11-22 00:05:09");
  assert.equal(formatTime(null), "—");
});

test("任务种类与状态有中文名，未知值原样返回", () => {
  assert.equal(jobKindLabel("export"), "导出");
  assert.equal(jobKindLabel("publish_draft"), "发布草稿");
  assert.equal(jobStatusLabel("cancel_requested"), "取消中");
  assert.equal(jobStatusLabel("weird"), "weird");
});
```

- [ ] **Step 5: 跑测试，确认失败**

Run: `node --import ./scripts/register-ts.mjs --test admin/app/lib/format.test.ts`  
Expected: FAIL（找不到 `./format`）。

- [ ] **Step 6: `admin/app/lib/format.ts`**

```ts
const KIND_LABELS: Record<string, string> = {
  prepare: "备料",
  export: "导出",
  cover: "封面",
  season: "合集",
  upload: "投稿",
  publish_draft: "发布草稿",
};

const STATUS_LABELS: Record<string, string> = {
  queued: "排队中",
  running: "运行中",
  succeeded: "成功",
  failed: "失败",
  cancel_requested: "取消中",
  cancelled: "已取消",
  interrupted: "已中断",
};

export const jobKindLabel = (kind: string): string => KIND_LABELS[kind] ?? kind;
export const jobStatusLabel = (status: string): string => STATUS_LABELS[status] ?? status;

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function formatTime(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}:${pick("second")}`;
}
```

- [ ] **Step 7: 跑测试与类型检查**

Run: `node --import ./scripts/register-ts.mjs --test admin/app/lib/format.test.ts`  
Expected: 4 个测试 pass。

Run: `nub exec tsc -p admin`  
Expected: 无输出。

- [ ] **Step 8: Commit**

```console
git add components.json package.json nub.lock admin/app
git commit -m ":sparkles: feat(admin): 接入 shadcn/ui 并添加格式化工具"
```

---

## Task 3: 外壳与共用组件

**Files:**
- Create: `admin/app/hooks/use-job-stream.ts`, `admin/app/components/{app-shell,data-table,status,confirm-button,progress-cell}.tsx`
- Create: 全部页面的占位路由（`library.index`、`library.albums.$id`、`jobs.index`、`jobs.$id`、`releases`、`history`、`settings`）
- Modify: `admin/app/routes/__root.tsx`

**Interfaces:**
- `AppShell`：侧边栏导航（总览、曲库、任务、投稿、历史、设置），底部显示 runner 在线状态和在跑任务数；内容区 `<Outlet />`。
- `useJobStream()`：订阅 `jobs.subscribe`，任何任务变化时让 `jobs`、`overview`、`releases`、`library` 的查询失效。
- `DataTable<T>`：TanStack Table 封装，支持排序、可选行选择。
- `JobStatusBadge`、`ReleaseStatusBadge`、`ConfirmButton`、`ProgressCell`。

- [ ] **Step 1: `hooks/use-job-stream.ts`**

```ts
import { useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useTRPC } from "@/lib/trpc";

/** 服务端只推「哪些任务变了」，这里据此让相关查询失效重取。 */
export function useJobStream(): void {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  useSubscription(
    trpc.jobs.subscribe.subscriptionOptions(undefined, {
      onData: () => {
        for (const key of [
          trpc.jobs.pathKey(),
          trpc.overview.pathKey(),
          trpc.releases.pathKey(),
          trpc.library.pathKey(),
          trpc.history.pathKey(),
        ]) {
          void queryClient.invalidateQueries({ queryKey: key });
        }
      },
    }),
  );
}
```

- [ ] **Step 2: `components/status.tsx`**

```tsx
import { Badge } from "@/components/ui/badge";
import { jobStatusLabel } from "@/lib/format";

const JOB_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  queued: "outline",
  running: "default",
  succeeded: "secondary",
  failed: "destructive",
  cancel_requested: "outline",
  cancelled: "outline",
  interrupted: "destructive",
};

export function JobStatusBadge({ status }: { status: string }) {
  return <Badge variant={JOB_VARIANT[status] ?? "outline"}>{jobStatusLabel(status)}</Badge>;
}

const RELEASE_LABEL: Record<string, string> = { pending: "待投稿", draft: "草稿", done: "已投稿" };
const RELEASE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  pending: "outline", draft: "default", done: "secondary",
};

export function ReleaseStatusBadge({ status }: { status: string }) {
  return <Badge variant={RELEASE_VARIANT[status] ?? "outline"}>{RELEASE_LABEL[status] ?? status}</Badge>;
}
```

- [ ] **Step 3: `components/progress-cell.tsx`**

```tsx
import { Progress } from "@/components/ui/progress";

export function ProgressCell({ value, active }: { value: number; active: boolean }) {
  if (!active) return null;
  return (
    <div className="flex items-center gap-2">
      <Progress value={Math.round(value * 100)} className="w-24" />
      <span className="text-muted-foreground text-xs tabular-nums">{Math.round(value * 100)}%</span>
    </div>
  );
}
```

- [ ] **Step 4: `components/confirm-button.tsx`**

```tsx
import type { ComponentProps, ReactNode } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function ConfirmButton({
  children, title, description, confirmLabel = "确认", onConfirm, ...buttonProps
}: {
  children: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
} & Omit<ComponentProps<typeof Button>, "onClick">) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button {...buttonProps}>{children}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 5: `components/data-table.tsx`**

```tsx
import {
  flexRender, getCoreRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type OnChangeFn, type RowSelectionState, type SortingState,
} from "@tanstack/react-table";
import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function DataTable<T>({
  columns, data, empty = "暂无数据", getRowId, rowSelection, onRowSelectionChange,
}: {
  columns: ColumnDef<T>[];
  data: T[];
  empty?: string;
  getRowId?: (row: T) => string;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data,
    columns,
    getRowId,
    state: { sorting, ...(rowSelection ? { rowSelection } : {}) },
    onSortingChange: setSorting,
    onRowSelectionChange,
    enableRowSelection: Boolean(onRowSelectionChange),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header) => (
              <TableHead
                key={header.id}
                className={header.column.getCanSort() ? "cursor-pointer select-none" : undefined}
                onClick={header.column.getToggleSortingHandler()}
              >
                {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                {{ asc: " ↑", desc: " ↓" }[header.column.getIsSorted() as string] ?? null}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={columns.length} className="text-muted-foreground h-24 text-center">
              {empty}
            </TableCell>
          </TableRow>
        ) : (
          table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} data-state={row.getIsSelected() ? "selected" : undefined}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 6: `components/app-shell.tsx`**

```tsx
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Disc3, History, LayoutDashboard, ListTodo, Send, Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader,
  SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider,
} from "@/components/ui/sidebar";
import { useJobStream } from "@/hooks/use-job-stream";
import { useTRPC } from "@/lib/trpc";

const NAV = [
  { to: "/", label: "总览", icon: LayoutDashboard },
  { to: "/library", label: "曲库", icon: Disc3 },
  { to: "/jobs", label: "任务", icon: ListTodo },
  { to: "/releases", label: "投稿", icon: Send },
  { to: "/history", label: "历史", icon: History },
  { to: "/settings", label: "设置", icon: Settings },
] as const;

export function AppShell() {
  useJobStream();
  const trpc = useTRPC();
  const overview = useQuery(trpc.overview.get.queryOptions(undefined, { refetchInterval: 10_000 }));
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const running = overview.data?.running.length ?? 0;
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="px-4 py-3 text-base font-semibold">rmv 管理后台</SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV.map((item) => {
                  const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={active}>
                        <Link to={item.to}>
                          <item.icon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="gap-2 px-4 py-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">runner</span>
            <Badge variant={overview.data?.runner.online ? "secondary" : "destructive"}>
              {overview.data?.runner.online ? "在线" : "离线"}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">在跑任务</span>
            <span className="tabular-nums">{running}</span>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <main className="flex flex-col gap-6 p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

- [ ] **Step 7: `__root.tsx` 里用 `AppShell`**

把 `component` 里的 `<Outlet />` 换成 `<AppShell />`，并 `import { AppShell } from "@/components/app-shell";`。

- [ ] **Step 8: 为后面的页面建占位路由（让导航里的 `Link` 在类型上成立）**

下面每个文件只有一个占位组件，后面的任务会整体覆盖。

`admin/app/routes/library.index.tsx`：

```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/library/")({ component: () => <p>曲库</p> });
```

`admin/app/routes/library.albums.$id.tsx`：

```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/library/albums/$id")({ component: () => <p>专辑</p> });
```

`admin/app/routes/jobs.index.tsx`：

```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/jobs/")({ component: () => <p>任务</p> });
```

`admin/app/routes/jobs.$id.tsx`：

```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/jobs/$id")({ component: () => <p>任务详情</p> });
```

`admin/app/routes/releases.tsx`、`history.tsx`、`settings.tsx` 同理，路径分别是 `"/releases"`、`"/history"`、`"/settings"`。

然后用 Task 1 Step 7 的一次性命令生成路由树。

- [ ] **Step 9: 类型检查**

Run: `nub exec tsc -p admin`  
Expected: 无输出。

- [ ] **Step 10: Commit**

```console
git add admin/app
git commit -m ":sparkles: feat(admin): 添加侧边栏外壳、任务实时订阅和共用表格组件"
```

---

## Task 4: 曲库页、备料与导出操作

**Files:**
- Create: `admin/app/components/{prepare-dialog,export-actions}.tsx`, `admin/app/routes/library.index.tsx`, `admin/app/routes/library.albums.$id.tsx`

**Interfaces:**
- `PrepareDialog`：填音频绝对路径与可选覆盖项，调用 `jobs.enqueuePrepare`。
- `ExportActions({ albumId?, trackIds?, label })`：三个按钮——「只导出」、「导出后上传」、「导出并上传」，加「覆盖已有成片」勾选；后两个要二次确认；成功后 toast 并跳转/刷新。
- 曲库页三个 Tab：专辑、单曲、备料目录（`library.scan`，未登记的有「登记」按钮）。
- 专辑详情：头部信息（合集 ID/小节 ID，没有时给「建合集」按钮），曲目表（可勾选，对勾选的曲目导出/上传），每首显示导出状态和最近一条成片状态。

- [ ] **Step 1: `components/prepare-dialog.tsx`**

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTRPC } from "@/lib/trpc";

const FORMATS = ["krc", "ttml", "yrc", "qrc", "lys", "lrc"] as const;

export function PrepareDialog() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [audio, setAudio] = useState("");
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [album, setAlbum] = useState("");
  const [offset, setOffset] = useState("");
  const [format, setFormat] = useState<string>("auto");
  const [credits, setCredits] = useState(false);
  const mutation = useMutation(trpc.jobs.enqueuePrepare.mutationOptions({
    onSuccess: (job) => {
      toast.success(`已入队备料 #${job.id}`);
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: trpc.jobs.pathKey() });
    },
    onError: (error) => toast.error(error.message),
  }));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>备料</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>备料</DialogTitle>
          <DialogDescription>
            拷到 <code>预处理/</code> 并匹配歌词、封面。没有歌词时备料会以非 0 退出，但 json 仍会写出。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="audio">音频或 CUE 的绝对路径</Label>
            <Input id="audio" value={audio} onChange={(e) => setAudio(e.target.value)} placeholder="/Users/…/半岛铁盒.flac" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5"><Label>歌名（可选）</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
            <div className="flex flex-col gap-1.5"><Label>歌手（可选）</Label><Input value={artist} onChange={(e) => setArtist(e.target.value)} /></div>
            <div className="flex flex-col gap-1.5"><Label>专辑（可选）</Label><Input value={album} onChange={(e) => setAlbum(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>歌词偏移（毫秒，核对后再填）</Label>
              <Input value={offset} onChange={(e) => setOffset(e.target.value)} inputMode="numeric" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>优先歌词格式</Label>
              <Select value={format} onValueChange={setFormat}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">默认</SelectItem>
                  {FORMATS.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={credits} onCheckedChange={(value) => setCredits(value === true)} />
            确认本次报出的首尾疑似署名为无效行
          </label>
        </div>
        <DialogFooter>
          <Button
            disabled={!audio || mutation.isPending}
            onClick={() => mutation.mutate({
              audio,
              ...(title ? { title } : {}),
              ...(artist ? { artist } : {}),
              ...(album ? { album } : {}),
              ...(offset !== "" && Number.isFinite(Number(offset)) ? { lyricOffsetMs: Number(offset) } : {}),
              ...(format !== "auto" ? { lyricFormat: format as (typeof FORMATS)[number] } : {}),
              ...(credits ? { acceptEdgeCredits: true } : {}),
            })}
          >
            入队
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: `components/export-actions.tsx`**

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmButton } from "@/components/confirm-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useTRPC } from "@/lib/trpc";

export function ExportActions({
  albumId, trackIds, disabled,
}: { albumId?: number; trackIds?: number[]; disabled?: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [overwrite, setOverwrite] = useState(false);
  const mutation = useMutation(trpc.jobs.enqueueExport.mutationOptions({
    onSuccess: (created) => {
      toast.success(`已入队 ${created.length} 个任务`);
      void queryClient.invalidateQueries({ queryKey: trpc.jobs.pathKey() });
    },
    onError: (error) => toast.error(error.message),
  }));
  const run = (mode: "export" | "export-then-upload" | "export-and-upload") =>
    mutation.mutate({ mode, albumId, trackIds, overwriteVideo: overwrite });
  const off = disabled || mutation.isPending;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" disabled={off} onClick={() => run("export")}>只导出</Button>
      <ConfirmButton
        variant="outline" disabled={off}
        title="导出后上传"
        description="全部导出完成后，再按顺序逐首投稿。投稿间隔和草稿降级按设置执行。"
        confirmLabel="入队"
        onConfirm={() => run("export-then-upload")}
      >
        导出后上传
      </ConfirmButton>
      <ConfirmButton
        disabled={off}
        title="导出并上传"
        description="每首导出完成后立刻排队投稿（一次一首，间隔按设置）。"
        confirmLabel="入队"
        onConfirm={() => run("export-and-upload")}
      >
        导出并上传
      </ConfirmButton>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={overwrite} onCheckedChange={(value) => setOverwrite(value === true)} />
        覆盖已有成片
      </label>
    </div>
  );
}
```

- [ ] **Step 3: `routes/library.index.tsx`**

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table";
import { ExportActions } from "@/components/export-actions";
import { PrepareDialog } from "@/components/prepare-dialog";
import { ReleaseStatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDuration } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/library/")({ component: Library });

function Library() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const albums = useQuery(trpc.library.albums.queryOptions());
  const singles = useQuery(trpc.library.singles.queryOptions());
  const scan = useQuery(trpc.library.scan.queryOptions());
  const register = useMutation(trpc.library.register.mutationOptions({
    onSuccess: (result) => {
      toast.success(result.album ? `已登记专辑《${result.album.title}》` : `已登记单曲 ${result.tracks[0]?.title ?? ""}`);
      void queryClient.invalidateQueries({ queryKey: trpc.library.pathKey() });
    },
    onError: (error) => toast.error(error.message),
  }));

  type Album = NonNullable<typeof albums.data>[number];
  const albumColumns: ColumnDef<Album>[] = [
    {
      accessorKey: "title", header: "专辑",
      cell: ({ row }) => (
        <Link to="/library/albums/$id" params={{ id: String(row.original.id) }} className="font-medium hover:underline">
          {row.original.title}
        </Link>
      ),
    },
    { accessorKey: "artist", header: "歌手" },
    { accessorKey: "year", header: "年份" },
    {
      id: "exported", header: "已导出",
      accessorFn: (row) => row.exportedCount,
      cell: ({ row }) => `${row.original.exportedCount} / ${row.original.trackCount}`,
    },
    {
      id: "season", header: "合集",
      cell: ({ row }) => row.original.sectionId
        ? <Badge variant="secondary">已建</Badge>
        : <Badge variant="outline">未建</Badge>,
    },
  ];

  type Single = NonNullable<typeof singles.data>["tracks"][number];
  const releaseByTrack = new Map((singles.data?.releases ?? []).map((row) => [row.trackId, row]));
  const singleColumns: ColumnDef<Single>[] = [
    { accessorKey: "title", header: "歌名" },
    { accessorKey: "artist", header: "歌手" },
    { id: "duration", header: "时长", accessorFn: (row) => row.durationSec ?? 0, cell: ({ row }) => formatDuration(row.original.durationSec) },
    { accessorKey: "lyricSource", header: "歌词来源" },
    {
      id: "export", header: "导出",
      cell: ({ row }) => <Badge variant={row.original.exportStatus === "exported" ? "secondary" : row.original.exportStatus === "failed" ? "destructive" : "outline"}>
        {row.original.exportStatus === "exported" ? "已导出" : row.original.exportStatus === "failed" ? "失败" : "未导出"}
      </Badge>,
    },
    {
      id: "release", header: "投稿",
      cell: ({ row }) => {
        const release = releaseByTrack.get(row.original.id);
        return release ? <ReleaseStatusBadge status={release.status} /> : "—";
      },
    },
    { id: "actions", header: "", cell: ({ row }) => <ExportActions trackIds={[row.original.id]} /> },
  ];

  type Dir = NonNullable<typeof scan.data>[number];
  const dirColumns: ColumnDef<Dir>[] = [
    { accessorKey: "name", header: "目录" },
    { id: "state", header: "状态", cell: ({ row }) => row.original.registered ? <Badge variant="secondary">已登记</Badge> : <Badge variant="outline">未登记</Badge> },
    {
      id: "actions", header: "",
      cell: ({ row }) => (
        <Button size="sm" variant="outline" disabled={register.isPending} onClick={() => register.mutate({ dir: row.original.dir })}>
          {row.original.registered ? "重新登记" : "登记"}
        </Button>
      ),
    },
  ];

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">曲库</h1>
        <PrepareDialog />
      </div>
      <Tabs defaultValue="albums">
        <TabsList>
          <TabsTrigger value="albums">专辑</TabsTrigger>
          <TabsTrigger value="singles">单曲</TabsTrigger>
          <TabsTrigger value="dirs">备料目录</TabsTrigger>
        </TabsList>
        <TabsContent value="albums"><DataTable columns={albumColumns} data={albums.data ?? []} empty="还没有登记的专辑，先到「备料目录」登记" /></TabsContent>
        <TabsContent value="singles"><DataTable columns={singleColumns} data={singles.data?.tracks ?? []} empty="没有单曲" /></TabsContent>
        <TabsContent value="dirs"><DataTable columns={dirColumns} data={scan.data ?? []} empty="预处理/ 下没有目录" /></TabsContent>
      </Tabs>
    </>
  );
}
```

- [ ] **Step 4: `routes/library.albums.$id.tsx`**

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { useState } from "react";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table";
import { ExportActions } from "@/components/export-actions";
import { ReleaseStatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDuration } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/library/albums/$id")({ component: AlbumPage });

function AlbumPage() {
  const { id } = Route.useParams();
  const albumId = Number(id);
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const detail = useQuery(trpc.library.album.queryOptions({ id: albumId }));
  const [selection, setSelection] = useState<RowSelectionState>({});
  const season = useMutation(trpc.seasons.ensureForAlbum.mutationOptions({
    onSuccess: (job) => {
      toast.success(`已入队建合集 #${job.id}`);
      void queryClient.invalidateQueries({ queryKey: trpc.jobs.pathKey() });
    },
    onError: (error) => toast.error(error.message),
  }));
  const data = detail.data;
  if (!data) return <p className="text-muted-foreground">加载中…</p>;

  type Track = (typeof data.tracks)[number];
  const releaseByTrack = new Map(data.releases.map((row) => [row.trackId, row]));
  const selectedIds = Object.keys(selection).filter((key) => selection[key]).map(Number);
  const columns: ColumnDef<Track>[] = [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllRowsSelected()}
          onCheckedChange={(value) => table.toggleAllRowsSelected(value === true)}
        />
      ),
      cell: ({ row }) => (
        <Checkbox checked={row.getIsSelected()} onCheckedChange={(value) => row.toggleSelected(value === true)} />
      ),
    },
    { accessorKey: "trackNo", header: "#" },
    { accessorKey: "title", header: "歌名" },
    { id: "duration", header: "时长", accessorFn: (row) => row.durationSec ?? 0, cell: ({ row }) => formatDuration(row.original.durationSec) },
    { accessorKey: "lyricSource", header: "歌词来源" },
    {
      id: "audio", header: "音轨",
      cell: ({ row }) => row.original.audioSampleRate
        ? `${row.original.audioSampleRate / 1000} kHz / ${row.original.audioBits ?? "?"} bit${row.original.audioLossless ? "" : "（有损）"}`
        : "—",
    },
    {
      id: "export", header: "导出",
      cell: ({ row }) => <Badge variant={row.original.exportStatus === "exported" ? "secondary" : row.original.exportStatus === "failed" ? "destructive" : "outline"}>
        {row.original.exportStatus === "exported" ? "已导出" : row.original.exportStatus === "failed" ? "失败" : "未导出"}
      </Badge>,
    },
    {
      id: "release", header: "投稿",
      cell: ({ row }) => {
        const release = releaseByTrack.get(row.original.id);
        return release ? <ReleaseStatusBadge status={release.status} /> : "—";
      },
    },
  ];

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link to="/library" className="text-muted-foreground text-sm hover:underline">← 曲库</Link>
        <h1 className="text-2xl font-semibold">{data.album.title}</h1>
        <p className="text-muted-foreground text-sm">
          {data.album.artist} · {data.album.year ?? "年份未知"} · {data.tracks.length} 首
        </p>
      </div>
      <Card>
        <CardHeader><CardTitle>合集</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-between gap-4 text-sm">
          {data.album.seasonId && data.album.sectionId
            ? <span>合集 {data.album.seasonId} · 小节 {data.album.sectionId}</span>
            : <span className="text-muted-foreground">还没有建合集（导出并上传时会自动建）</span>}
          <Button variant="outline" size="sm" disabled={season.isPending} onClick={() => season.mutate({ albumId })}>
            {data.album.seasonId ? "重新检查合集" : "建合集"}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>导出与投稿</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">整张专辑</span>
            <ExportActions albumId={albumId} />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">勾选的 {selectedIds.length} 首</span>
            <ExportActions albumId={albumId} trackIds={selectedIds} disabled={selectedIds.length === 0} />
          </div>
        </CardContent>
      </Card>
      <DataTable
        columns={columns}
        data={data.tracks}
        getRowId={(row) => String(row.id)}
        rowSelection={selection}
        onRowSelectionChange={setSelection}
      />
    </>
  );
}
```

- [ ] **Step 5: 重新生成路由树并类型检查**

先按「路由树」一节的一次性命令重新生成 `routeTree.gen.ts`，再：

Run: `nub exec tsc -p admin`  
Expected: 无输出。

- [ ] **Step 6: 看一眼页面**

Run（前台，用演练库）：`RMV_DB=/tmp/rmv-fe.db nub run admin`  
在浏览器打开 `http://127.0.0.1:3100/library`，确认：能看到三个 Tab；「备料目录」列出 `预处理/` 下的目录；点「登记」后目录变成「已登记」，专辑 Tab 里出现该专辑，点进去能看到曲目表。看完 Ctrl-C。

- [ ] **Step 7: Commit**

```console
git add admin/app
git commit -m ":sparkles: feat(admin): 添加曲库页、专辑详情页、备料对话框和导出投稿操作"
```

---

## Task 5: 任务页与任务详情（实时日志）

**Files:**
- Create: `admin/app/routes/jobs.index.tsx`, `admin/app/routes/jobs.$id.tsx`

**Interfaces:**
- `/jobs`：搜索参数 `status`（可选）、`kind`（可选）；表格列：#、种类、对象、状态、进度、创建时间、耗时、操作（取消/重试）；顶部状态与种类筛选；「加载更多」用 `nextBefore`。
- `/jobs/$id`：任务信息（状态、依赖的上游、被谁依赖、错误、payload、result）；日志面板用 `jobs.logs` 取历史 + `jobs.subscribeLogs` 追加新行，自动滚到底，可暂停滚动；取消需确认；失败/取消/中断时有「重试」。

- [ ] **Step 1: `routes/jobs.index.tsx`**

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmButton } from "@/components/confirm-button";
import { DataTable } from "@/components/data-table";
import { ProgressCell } from "@/components/progress-cell";
import { JobStatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDuration, formatTime, jobKindLabel, jobStatusLabel } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

const STATUSES = ["queued", "running", "succeeded", "failed", "cancel_requested", "cancelled", "interrupted"] as const;
const KINDS = ["prepare", "export", "cover", "season", "upload", "publish_draft"] as const;
type Status = (typeof STATUSES)[number];
type Kind = (typeof KINDS)[number];

export const Route = createFileRoute("/jobs/")({
  validateSearch: (search: Record<string, unknown>): { status?: Status; kind?: Kind } => ({
    status: STATUSES.find((item) => item === search.status),
    kind: KINDS.find((item) => item === search.kind),
  }),
  component: Jobs,
});

function Jobs() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/jobs/" });
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [before, setBefore] = useState<number | undefined>(undefined);
  const list = useQuery(trpc.jobs.list.queryOptions({
    status: search.status ? [search.status] : undefined,
    kind: search.kind,
    before,
    limit: 50,
  }));
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.jobs.pathKey() });
  const cancel = useMutation(trpc.jobs.cancel.mutationOptions({ onSuccess: refresh, onError: (e) => toast.error(e.message) }));
  const retry = useMutation(trpc.jobs.retry.mutationOptions({
    onSuccess: (job) => { toast.success(`已重新入队 #${job.id}`); void refresh(); },
    onError: (e) => toast.error(e.message),
  }));

  type Row = NonNullable<typeof list.data>["rows"][number];
  const columns: ColumnDef<Row>[] = [
    { accessorKey: "id", header: "#", cell: ({ row }) => <Link to="/jobs/$id" params={{ id: String(row.original.id) }} className="underline-offset-4 hover:underline">#{row.original.id}</Link> },
    { id: "kind", header: "种类", accessorFn: (row) => jobKindLabel(row.kind) },
    { id: "target", header: "对象", cell: ({ row }) => row.original.trackTitle ?? row.original.albumTitle ?? row.original.releaseId ?? "—" },
    { id: "status", header: "状态", cell: ({ row }) => <JobStatusBadge status={row.original.status} /> },
    { id: "progress", header: "进度", cell: ({ row }) => <ProgressCell value={row.original.progress} active={row.original.status === "running"} /> },
    { id: "created", header: "创建", accessorFn: (row) => row.createdAt, cell: ({ row }) => formatTime(row.original.createdAt) },
    {
      id: "took", header: "耗时",
      cell: ({ row }) => row.original.startedAt != null && row.original.finishedAt != null
        ? formatDuration((row.original.finishedAt - row.original.startedAt) / 1000) : "—",
    },
    {
      id: "actions", header: "",
      cell: ({ row }) => {
        const status = row.original.status;
        if (status === "queued" || status === "running") {
          return (
            <ConfirmButton
              size="sm" variant="outline"
              title={`取消 #${row.original.id}？`}
              description={status === "running" ? "会中止正在运行的子进程，依赖它的后续任务也会被取消。" : "依赖它的后续任务也会被取消。"}
              confirmLabel="取消任务"
              onConfirm={() => cancel.mutate({ id: row.original.id })}
            >
              取消
            </ConfirmButton>
          );
        }
        if (status === "failed" || status === "cancelled" || status === "interrupted") {
          return <Button size="sm" variant="outline" onClick={() => retry.mutate({ id: row.original.id })}>重试</Button>;
        }
        return null;
      },
    },
  ];

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">任务</h1>
        <div className="flex gap-2">
          <Select value={search.status ?? "all"} onValueChange={(value) => { setBefore(undefined); void navigate({ search: (prev) => ({ ...prev, status: value === "all" ? undefined : (value as Status) }) }); }}>
            <SelectTrigger className="w-36"><SelectValue placeholder="状态" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              {STATUSES.map((item) => <SelectItem key={item} value={item}>{jobStatusLabel(item)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={search.kind ?? "all"} onValueChange={(value) => { setBefore(undefined); void navigate({ search: (prev) => ({ ...prev, kind: value === "all" ? undefined : (value as Kind) }) }); }}>
            <SelectTrigger className="w-36"><SelectValue placeholder="种类" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部种类</SelectItem>
              {KINDS.map((item) => <SelectItem key={item} value={item}>{jobKindLabel(item)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <DataTable columns={columns} data={list.data?.rows ?? []} empty="没有任务" />
      <div className="flex justify-between">
        <Button variant="outline" size="sm" disabled={before === undefined} onClick={() => setBefore(undefined)}>回到最新</Button>
        <Button variant="outline" size="sm" disabled={!list.data?.nextBefore} onClick={() => setBefore(list.data?.nextBefore ?? undefined)}>更早的</Button>
      </div>
    </>
  );
}
```

- [ ] **Step 2: `routes/jobs.$id.tsx`**

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmButton } from "@/components/confirm-button";
import { ProgressCell } from "@/components/progress-cell";
import { JobStatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { formatTime, jobKindLabel } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/jobs/$id")({ component: JobDetail });

type LogLine = { id: number; ts: number; stream: string; line: string };

function JobDetail() {
  const { id } = Route.useParams();
  const jobId = Number(id);
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const detail = useQuery(trpc.jobs.get.queryOptions({ id: jobId }, { refetchInterval: 3000 }));
  const history = useQuery(trpc.jobs.logs.queryOptions({ id: jobId, afterId: 0, limit: 2000 }));
  const [live, setLive] = useState<LogLine[]>([]);
  const [follow, setFollow] = useState(true);
  const bottom = useRef<HTMLDivElement>(null);

  const lastHistoryId = history.data?.at(-1)?.id ?? 0;
  useSubscription(
    trpc.jobs.subscribeLogs.subscriptionOptions(
      { jobId, afterId: lastHistoryId },
      {
        enabled: history.isSuccess,
        onData: (event) => setLive((current) => [...current, ...event.data]),
      },
    ),
  );
  const lines = [...(history.data ?? []), ...live];
  useEffect(() => {
    if (follow) bottom.current?.scrollIntoView({ block: "end" });
  }, [lines.length, follow]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.jobs.pathKey() });
  const cancel = useMutation(trpc.jobs.cancel.mutationOptions({ onSuccess: refresh, onError: (e) => toast.error(e.message) }));
  const retry = useMutation(trpc.jobs.retry.mutationOptions({
    onSuccess: (job) => { toast.success(`已重新入队 #${job.id}`); void refresh(); },
    onError: (e) => toast.error(e.message),
  }));

  const data = detail.data;
  if (!data) return <p className="text-muted-foreground">加载中…</p>;
  const { job } = data;
  const active = job.status === "queued" || job.status === "running";
  const retriable = ["failed", "cancelled", "interrupted"].includes(job.status);

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link to="/jobs" className="text-muted-foreground text-sm hover:underline">← 任务</Link>
        <div className="flex items-center justify-between">
          <h1 className="flex items-center gap-3 text-2xl font-semibold">
            #{job.id} {jobKindLabel(job.kind)} <JobStatusBadge status={job.status} />
          </h1>
          <div className="flex gap-2">
            {active && (
              <ConfirmButton
                variant="outline"
                title={`取消 #${job.id}？`}
                description="会中止正在运行的子进程，依赖它的后续任务也会被取消。"
                confirmLabel="取消任务"
                onConfirm={() => cancel.mutate({ id: job.id })}
              >
                取消
              </ConfirmButton>
            )}
            {retriable && <Button onClick={() => retry.mutate({ id: job.id })}>重试</Button>}
          </div>
        </div>
        <p className="text-muted-foreground text-sm">
          {job.trackTitle ?? job.albumTitle ?? job.releaseId ?? ""}
          {job.retryOf ? <> · 重试自 <Link to="/jobs/$id" params={{ id: String(job.retryOf) }} className="underline">#{job.retryOf}</Link></> : null}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>信息</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div>创建：{formatTime(job.createdAt)}</div>
            <div>开始：{formatTime(job.startedAt)}</div>
            <div>结束：{formatTime(job.finishedAt)}</div>
            <ProgressCell value={job.progress} active={job.status === "running"} />
            {job.error && <pre className="text-destructive whitespace-pre-wrap">{job.error}</pre>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>依赖</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div>
              上游：
              {data.upstream.length === 0 ? "无" : data.upstream.map((item) => (
                <Link key={item.id} to="/jobs/$id" params={{ id: String(item.id) }} className="mr-2 underline">
                  #{item.id} {jobKindLabel(item.kind)}（{item.status}）
                </Link>
              ))}
            </div>
            <div>
              下游：
              {data.downstream.length === 0 ? "无" : data.downstream.map((item) => (
                <Link key={item.id} to="/jobs/$id" params={{ id: String(item.id) }} className="mr-2 underline">
                  #{item.id} {jobKindLabel(item.kind)}（{item.status}）
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>参数与结果</CardTitle></CardHeader>
        <CardContent>
          <pre className="bg-muted overflow-auto rounded-md p-3 text-xs">
            {JSON.stringify({ payload: job.payload, result: job.result }, null, 2)}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>日志（{lines.length} 行）</CardTitle>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={follow} onCheckedChange={(value) => setFollow(value === true)} />
            自动滚到底
          </label>
        </CardHeader>
        <CardContent>
          <div className="bg-muted h-96 overflow-auto rounded-md p-3 font-mono text-xs">
            {lines.map((line) => (
              <div key={line.id} className={line.stream === "stderr" ? "text-destructive" : line.stream === "system" ? "text-muted-foreground" : undefined}>
                {line.line}
              </div>
            ))}
            <div ref={bottom} />
          </div>
        </CardContent>
      </Card>
    </>
  );
}
```

- [ ] **Step 3: 重新生成路由树并类型检查**

先按「路由树」一节的一次性命令重新生成 `routeTree.gen.ts`，再：

Run: `nub exec tsc -p admin`  
Expected: 无输出。

- [ ] **Step 4: 看一眼页面**

Run: `RMV_DB=/tmp/rmv-fe.db nub run admin`  
在专辑页对一首「只导出」入队（runner 在线会真的开始渲染；想只看界面可以先在设置里把 `render.maxParallel` 保持 1，入队后立刻到 `/jobs` 点取消）。确认：`/jobs` 列表出现任务，状态和进度刷新不需要手动刷新页面；`/jobs/<id>` 日志随输出追加；取消需要二次确认。Ctrl-C 结束。

- [ ] **Step 5: Commit**

```console
git add admin/app
git commit -m ":sparkles: feat(admin): 添加任务列表、任务详情和实时日志"
```

---

## Task 6: 总览页

**Files:**
- Modify: `admin/app/routes/index.tsx`

页面内容：

- 设置警告横幅（`overview.warnings`）。
- runner 卡片：在线/离线；离线时提示在终端运行 `nub run admin` 或 `nub run admin:runner`。
- 投稿节奏卡片：上次成功投稿时间、下一次最早投稿时间（`lastUploadOkAt + upload.minIntervalSec`）、`hold_until`（有值且未到时显示）、`locked_since`。
- 队列卡片：各状态任务数、各状态成片数。
- 在跑任务列表：种类、对象、进度条、链接到详情。
- 健康卡片：登录态（存在与否、过期时间）、`biliup`/`ffmpeg`/`nub` 是否可用、`out/` 剩余磁盘。

- [ ] **Step 1: 写 `admin/app/routes/index.tsx`**

```tsx
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ProgressCell } from "@/components/progress-cell";
import { JobStatusBadge } from "@/components/status";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBytes, formatTime, jobKindLabel } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/")({ component: Overview });

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function Overview() {
  const trpc = useTRPC();
  const overview = useQuery(trpc.overview.get.queryOptions(undefined, { refetchInterval: 5000 }));
  const settings = useQuery(trpc.settings.get.queryOptions());
  const health = useQuery(trpc.system.health.queryOptions(undefined, { refetchInterval: 60_000 }));
  const data = overview.data;
  if (!data) return <p className="text-muted-foreground">加载中…</p>;

  const minInterval = (settings.data?.values["upload.minIntervalSec"] ?? 180) * 1000;
  const nextUploadAt = data.state.lastUploadOkAt != null ? data.state.lastUploadOkAt + minInterval : null;
  const held = data.state.holdUntil != null && data.state.holdUntil > data.now;

  return (
    <>
      <h1 className="text-2xl font-semibold">总览</h1>
      {data.warnings.map((warning) => (
        <Alert key={warning.key}>
          <AlertTitle>{warning.key}</AlertTitle>
          <AlertDescription>{warning.message}</AlertDescription>
        </Alert>
      ))}
      {!data.runner.online && (
        <Alert variant="destructive">
          <AlertTitle>runner 没有运行</AlertTitle>
          <AlertDescription>
            任务会一直排队。在终端前台运行 <code>nub run admin</code>（web + runner）或 <code>nub run admin:runner</code>。
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader><CardTitle>runner</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Row label="状态">
              <Badge variant={data.runner.online ? "secondary" : "destructive"}>
                {data.runner.online ? "在线" : "离线"}
              </Badge>
            </Row>
            <Row label="进程">{data.runner.pid ?? "—"}</Row>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>投稿节奏</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Row label="上次成功投稿">{formatTime(data.state.lastUploadOkAt)}</Row>
            <Row label="下一次最早">{nextUploadAt != null && nextUploadAt > data.now ? formatTime(nextUploadAt) : "现在可以"}</Row>
            <Row label="暂停到">{held ? formatTime(data.state.holdUntil) : "—"}</Row>
            <Row label="锁屏起点">{formatTime(data.state.lockedSince)}</Row>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>任务</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2">
            {["queued", "running", "failed", "interrupted"].map((status) => (
              <Row key={status} label={status === "queued" ? "排队中" : status === "running" ? "运行中" : status === "failed" ? "失败" : "已中断"}>
                <Link to="/jobs" search={{ status: status as "queued" | "running" | "failed" | "interrupted" }} className="tabular-nums underline-offset-4 hover:underline">
                  {data.jobCounts[status] ?? 0}
                </Link>
              </Row>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>成片</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Row label="待投稿">{data.releaseCounts.pending ?? 0}</Row>
            <Row label="草稿">{data.releaseCounts.draft ?? 0}</Row>
            <Row label="已投稿">{data.releaseCounts.done ?? 0}</Row>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>正在运行</CardTitle>
          <CardDescription>渲染和投稿各占一条车道，互不阻塞。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {data.running.length === 0 && <p className="text-muted-foreground text-sm">没有在跑的任务</p>}
          {data.running.map((job) => (
            <div key={job.id} className="flex items-center justify-between gap-4">
              <Link to="/jobs/$id" params={{ id: String(job.id) }} className="hover:underline">
                #{job.id} {jobKindLabel(job.kind)} · {job.trackTitle ?? job.albumTitle ?? job.releaseId ?? ""}
              </Link>
              <div className="flex items-center gap-3">
                <ProgressCell value={job.progress} active />
                <JobStatusBadge status={job.status} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>环境</CardTitle></CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-2">
          <Row label="B 站登录态">
            {health.data?.cookies.exists
              ? health.data.cookies.expiresAt
                ? `有效至 ${formatTime(health.data.cookies.expiresAt)}`
                : "存在"
              : <Badge variant="destructive">缺失</Badge>}
          </Row>
          <Row label="biliup">{health.data?.binaries.biliup ?? <Badge variant="destructive">找不到</Badge>}</Row>
          <Row label="ffmpeg">{health.data?.binaries.ffmpeg ?? <Badge variant="destructive">找不到</Badge>}</Row>
          <Row label="nub">{health.data?.binaries.nub ?? <Badge variant="destructive">找不到</Badge>}</Row>
          <Row label="out/ 所在磁盘剩余">{formatBytes(health.data?.diskFreeBytes)}</Row>
          <Row label="数据库">{health.data?.dbFile ?? "—"}</Row>
        </CardContent>
      </Card>
    </>
  );
}
```

- [ ] **Step 2: 重新生成路由树并类型检查**

先按「路由树」一节的一次性命令重新生成 `routeTree.gen.ts`，再：

Run: `nub exec tsc -p admin`  
Expected: 无输出。

- [ ] **Step 3: Commit**

```console
git add admin/app
git commit -m ":sparkles: feat(admin): 添加总览页"
```

---

## Task 7: 投稿页

**Files:**
- Create: `admin/app/components/release-sheet.tsx`, `admin/app/routes/releases.tsx`

**Interfaces:**
- 三个 Tab：待投稿、草稿、已投稿。表格列：标题、模式（新投/覆盖）、状态、最近任务、创建/完成时间、BV 号（已投稿时链接到 `https://www.bilibili.com/video/<bvid>`）。
- 待投稿：多选「立即上传」（`releases.enqueueUpload`，二次确认）；每行「编辑」（侧边抽屉改 `title/desc/tag/tid/copyright/dynamic/hires/cover`）、「重新抽封面」、「删除」（二次确认）。有进行中任务的行禁用编辑/删除并显示链接。
- 草稿：多选「发布草稿」（同样走 `enqueueUpload`）。
- 已投稿：没加入合集的行有「补加入合集」（`seasons.addRelease`）。
- 页面顶部：草稿箱 `已用/容量`（`releases.draftBox`，读取失败时显示原因）；`hold_until` 未到时显示「暂停到 xx」横幅；限流提示。

- [ ] **Step 1: `components/release-sheet.tsx`**

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useTRPC } from "@/lib/trpc";

export type EditableRelease = {
  id: string;
  title: string;
  uploadTitle: string;
  uploadDesc: string;
  uploadTag: string;
  uploadCover: string;
  uploadTid: number;
  uploadCopyright: number;
  uploadDynamic: string;
  uploadHires: number;
};

export function ReleaseSheet({
  release, onClose,
}: { release: EditableRelease | null; onClose: () => void }) {
  return (
    <Sheet open={release !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {release && <Form key={release.id} release={release} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  );
}

function Form({ release, onClose }: { release: EditableRelease; onClose: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(release.uploadTitle);
  const [desc, setDesc] = useState(release.uploadDesc);
  const [tag, setTag] = useState(release.uploadTag);
  const [cover, setCover] = useState(release.uploadCover);
  const [tid, setTid] = useState(String(release.uploadTid));
  const [copyright, setCopyright] = useState(String(release.uploadCopyright));
  const [dynamic, setDynamic] = useState(release.uploadDynamic);
  const [hires, setHires] = useState(String(release.uploadHires));
  const save = useMutation(trpc.releases.updateUpload.mutationOptions({
    onSuccess: () => {
      toast.success("已保存");
      void queryClient.invalidateQueries({ queryKey: trpc.releases.pathKey() });
      onClose();
    },
    onError: (error) => toast.error(error.message),
  }));
  return (
    <>
      <SheetHeader>
        <SheetTitle>编辑上传信息</SheetTitle>
        <SheetDescription>{release.title}。只对「待投稿」且没有进行中任务的成片生效。</SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-4 px-4">
        <div className="flex flex-col gap-1.5"><Label>标题</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="flex flex-col gap-1.5"><Label>简介</Label><Textarea rows={8} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
        <div className="flex flex-col gap-1.5"><Label>标签（逗号分隔）</Label><Input value={tag} onChange={(e) => setTag(e.target.value)} /></div>
        <div className="flex flex-col gap-1.5"><Label>封面（成片旁的 jpg 路径）</Label><Input value={cover} onChange={(e) => setCover(e.target.value)} /></div>
        <div className="flex flex-col gap-1.5"><Label>空间动态（专辑批量只给一条带）</Label><Input value={dynamic} onChange={(e) => setDynamic(e.target.value)} /></div>
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1.5"><Label>分区 tid</Label><Input value={tid} onChange={(e) => setTid(e.target.value)} inputMode="numeric" /></div>
          <div className="flex flex-col gap-1.5">
            <Label>版权</Label>
            <Select value={copyright} onValueChange={setCopyright}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="1">自制</SelectItem><SelectItem value="2">转载</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Hi-Res</Label>
            <Select value={hires} onValueChange={setHires}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="0">关</SelectItem><SelectItem value="1">开</SelectItem></SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-muted-foreground text-xs">
          Hi-Res 只在封装进成片的音轨是无损且采样率不低于 96 kHz（或不低于 48 kHz 且位深不低于 24 bit）时才开。
        </p>
      </div>
      <SheetFooter>
        <Button
          disabled={save.isPending}
          onClick={() => save.mutate({
            id: release.id, title, desc, tag, cover, dynamic,
            tid: Number(tid),
            copyright: copyright === "2" ? 2 : 1,
            hires: hires === "1" ? 1 : 0,
          })}
        >
          保存
        </Button>
      </SheetFooter>
    </>
  );
}
```

- [ ] **Step 2: `routes/releases.tsx`**

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmButton } from "@/components/confirm-button";
import { DataTable } from "@/components/data-table";
import { ReleaseSheet, type EditableRelease } from "@/components/release-sheet";
import { JobStatusBadge, ReleaseStatusBadge } from "@/components/status";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatTime } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/releases")({ component: Releases });

type Tab = "pending" | "draft" | "done";

function Releases() {
  const [tab, setTab] = useState<Tab>("pending");
  const [editing, setEditing] = useState<EditableRelease | null>(null);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const list = useQuery(trpc.releases.list.queryOptions({ status: tab }));
  const overview = useQuery(trpc.overview.get.queryOptions(undefined, { refetchInterval: 5000 }));
  const draftBox = useQuery(trpc.releases.draftBox.queryOptions(undefined, { staleTime: 30_000 }));

  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.releases.pathKey() });
  const enqueue = useMutation(trpc.releases.enqueueUpload.mutationOptions({
    onSuccess: (created) => {
      toast.success(`已入队 ${created.length} 个任务`);
      setSelection({});
      void refresh();
      void queryClient.invalidateQueries({ queryKey: trpc.jobs.pathKey() });
    },
    onError: (error) => toast.error(error.message),
  }));
  const remove = useMutation(trpc.releases.remove.mutationOptions({ onSuccess: refresh, onError: (e) => toast.error(e.message) }));
  const regen = useMutation(trpc.releases.regenCover.mutationOptions({
    onSuccess: (job) => toast.success(`已入队抽封面 #${job.id}`),
    onError: (e) => toast.error(e.message),
  }));
  const addSeason = useMutation(trpc.seasons.addRelease.mutationOptions({
    onSuccess: (job) => toast.success(`已入队加入合集 #${job.id}`),
    onError: (e) => toast.error(e.message),
  }));

  type Row = NonNullable<typeof list.data>[number];
  const selectedIds = Object.keys(selection).filter((key) => selection[key]);
  const columns: ColumnDef<Row>[] = [
    ...(tab !== "done" ? [{
      id: "select",
      header: ({ table }) => <Checkbox checked={table.getIsAllRowsSelected()} onCheckedChange={(v) => table.toggleAllRowsSelected(v === true)} />,
      cell: ({ row }) => <Checkbox checked={row.getIsSelected()} disabled={Boolean(row.original.activeJob)} onCheckedChange={(v) => row.toggleSelected(v === true)} />,
    } satisfies ColumnDef<Row>] : []),
    { accessorKey: "title", header: "标题" },
    { id: "mode", header: "模式", cell: ({ row }) => <Badge variant="outline">{row.original.mode === "overwrite" ? "覆盖" : "新投"}</Badge> },
    { id: "status", header: "状态", cell: ({ row }) => <ReleaseStatusBadge status={row.original.status} /> },
    {
      id: "job", header: "最近任务",
      cell: ({ row }) => row.original.lastJob ? (
        <Link to="/jobs/$id" params={{ id: String(row.original.lastJob.id) }} className="flex items-center gap-2 hover:underline">
          #{row.original.lastJob.id} <JobStatusBadge status={row.original.lastJob.status} />
        </Link>
      ) : "—",
    },
    { id: "created", header: "创建", accessorFn: (row) => row.createdAt, cell: ({ row }) => formatTime(row.original.createdAt) },
    ...(tab === "done" ? [{
      id: "bvid", header: "稿件",
      cell: ({ row }) => row.original.bvid ? (
        <a className="underline" href={`https://www.bilibili.com/video/${row.original.bvid}`} target="_blank" rel="noreferrer">{row.original.bvid}</a>
      ) : "—",
    } satisfies ColumnDef<Row>, {
      id: "finished", header: "完成", cell: ({ row }) => formatTime(row.original.finishedAt),
    } satisfies ColumnDef<Row>] : []),
    {
      id: "actions", header: "",
      cell: ({ row }) => {
        const release = row.original;
        const busy = Boolean(release.activeJob);
        if (release.status === "pending") {
          return (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(release)}>编辑</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => regen.mutate({ id: release.id })}>重新抽封面</Button>
              <ConfirmButton
                size="sm" variant="outline" disabled={busy}
                title="删除这条待投稿？" description="只删除队列里的记录，不删成片文件。"
                confirmLabel="删除" onConfirm={() => remove.mutate({ id: release.id })}
              >
                删除
              </ConfirmButton>
            </div>
          );
        }
        if (release.status === "done" && release.bvid && !release.seasonAdded) {
          return <Button size="sm" variant="outline" disabled={busy} onClick={() => addSeason.mutate({ releaseId: release.id })}>补加入合集</Button>;
        }
        return null;
      },
    },
  ];

  const holdUntil = overview.data?.state.holdUntil;
  const held = holdUntil != null && holdUntil > (overview.data?.now ?? 0);

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">投稿</h1>
        <div className="text-sm">
          草稿箱：{draftBox.data?.ok
            ? <Badge variant={draftBox.data.used >= draftBox.data.capacity ? "destructive" : "secondary"}>{draftBox.data.used} / {draftBox.data.capacity}</Badge>
            : <span className="text-muted-foreground">读取失败（{draftBox.data?.error ?? "…"}）</span>}
        </div>
      </div>
      {held && (
        <Alert variant="destructive">
          <AlertTitle>投稿暂停到 {formatTime(holdUntil)}</AlertTitle>
          <AlertDescription>覆盖稿遇到了 137022 投稿过于频繁，按规则次日 00:00 之后再开传，剩下的覆盖留在队列里。</AlertDescription>
        </Alert>
      )}
      <Tabs value={tab} onValueChange={(value) => { setTab(value as Tab); setSelection({}); }}>
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="pending">待投稿</TabsTrigger>
            <TabsTrigger value="draft">草稿</TabsTrigger>
            <TabsTrigger value="done">已投稿</TabsTrigger>
          </TabsList>
          {tab !== "done" && (
            <ConfirmButton
              disabled={selectedIds.length === 0 || enqueue.isPending}
              title={tab === "draft" ? `发布 ${selectedIds.length} 条草稿？` : `立即上传 ${selectedIds.length} 条？`}
              description="按勾选顺序串成一条链，一次一条，间隔和限流降级按设置执行。前一条失败后面的会被取消。"
              confirmLabel="入队"
              onConfirm={() => enqueue.mutate({ ids: selectedIds })}
            >
              {tab === "draft" ? "发布选中的草稿" : "立即上传选中的"}
            </ConfirmButton>
          )}
        </div>
        {(["pending", "draft", "done"] as const).map((value) => (
          <TabsContent key={value} value={value}>
            <DataTable
              columns={columns}
              data={list.data ?? []}
              getRowId={(row) => row.id}
              rowSelection={selection}
              onRowSelectionChange={setSelection}
              empty="没有记录"
            />
          </TabsContent>
        ))}
      </Tabs>
      <ReleaseSheet release={editing} onClose={() => setEditing(null)} />
    </>
  );
}
```

- [ ] **Step 3: 重新生成路由树并类型检查**

先按「路由树」一节的一次性命令重新生成 `routeTree.gen.ts`，再：

Run: `nub exec tsc -p admin`  
Expected: 无输出。常见要调的地方：`satisfies ColumnDef<Row>` 展开进数组时的联合类型，必要时把条件列单独定义成带类型的常量再展开。

- [ ] **Step 4: Commit**

```console
git add admin/app
git commit -m ":sparkles: feat(admin): 添加投稿页，支持编辑上传信息、立即上传、发布草稿和补加合集"
```

---

## Task 8: 历史页与设置页

**Files:**
- Create: `admin/app/routes/history.tsx`, `admin/app/routes/settings.tsx`

**Interfaces:**
- 历史：两个 Tab。「导出」表：曲目、状态、耗时、是否跳过、结束时间、失败原因；顶部统计：近 30 天平均渲染时长、按天的导出/投稿数（用 CSS 横条，不引入图表库）。「投稿」表：标题、BV 号、完成时间、是否已加合集。
- 设置：按组渲染（并行、间隔、重试等待、空闲调度、草稿、日志、可执行文件）；每项显示默认值、与默认值不同时有「恢复默认」；有警告的项旁边显示警告；底部「保存」一次提交所有改动，「全部恢复默认」需确认；`idle.nightStartHour` 必须小于 `idle.nightEndHour`（服务端校验，错误 toast 出来）。

- [ ] **Step 1: `routes/history.tsx`**

```tsx
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { JobStatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDuration, formatTime } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/history")({ component: History });

function History() {
  const trpc = useTRPC();
  const exports = useQuery(trpc.history.exports.queryOptions({ limit: 100 }));
  const uploads = useQuery(trpc.history.uploads.queryOptions({ limit: 100 }));
  const stats = useQuery(trpc.history.stats.queryOptions());

  type ExportRow = NonNullable<typeof exports.data>[number];
  const exportColumns: ColumnDef<ExportRow>[] = [
    { id: "id", header: "#", cell: ({ row }) => <Link to="/jobs/$id" params={{ id: String(row.original.id) }} className="hover:underline">#{row.original.id}</Link> },
    { id: "track", header: "曲目", cell: ({ row }) => `${row.original.trackTitle ?? "—"}${row.original.albumTitle ? `（${row.original.albumTitle}）` : ""}` },
    { id: "status", header: "结果", cell: ({ row }) => <JobStatusBadge status={row.original.status} /> },
    { id: "skipped", header: "", cell: ({ row }) => row.original.skipped ? <Badge variant="outline">跳过（已有成片）</Badge> : null },
    { id: "took", header: "耗时", accessorFn: (row) => row.durationSec ?? 0, cell: ({ row }) => formatDuration(row.original.durationSec) },
    { id: "finished", header: "结束", accessorFn: (row) => row.finishedAt ?? 0, cell: ({ row }) => formatTime(row.original.finishedAt) },
    { id: "error", header: "原因", cell: ({ row }) => <span className="text-destructive line-clamp-1 max-w-80">{row.original.error ?? ""}</span> },
  ];

  type UploadRow = NonNullable<typeof uploads.data>[number];
  const uploadColumns: ColumnDef<UploadRow>[] = [
    { accessorKey: "title", header: "标题" },
    {
      id: "bvid", header: "稿件",
      cell: ({ row }) => row.original.bvid
        ? <a className="underline" href={`https://www.bilibili.com/video/${row.original.bvid}`} target="_blank" rel="noreferrer">{row.original.bvid}</a>
        : "—",
    },
    { id: "season", header: "合集", cell: ({ row }) => row.original.seasonAdded ? <Badge variant="secondary">已加入</Badge> : <Badge variant="outline">未加入</Badge> },
    { id: "finished", header: "完成", accessorFn: (row) => row.finishedAt ?? 0, cell: ({ row }) => formatTime(row.original.finishedAt) },
  ];

  const days = stats.data?.days ?? [];
  const peak = Math.max(1, ...days.map((day) => Math.max(day.exports, day.uploads)));

  return (
    <>
      <h1 className="text-2xl font-semibold">历史</h1>
      <Card>
        <CardHeader><CardTitle>近 30 天</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div>平均渲染时长：{stats.data?.avgRenderSec != null ? formatDuration(stats.data.avgRenderSec) : "—"}</div>
          {days.length === 0 && <p className="text-muted-foreground">还没有记录</p>}
          {days.map((day) => (
            <div key={day.day} className="grid grid-cols-[6rem_1fr_6rem] items-center gap-3">
              <span className="text-muted-foreground tabular-nums">{day.day}</span>
              <div className="flex flex-col gap-1">
                <div className="bg-primary h-2 rounded" style={{ width: `${(day.exports / peak) * 100}%` }} />
                <div className="bg-secondary-foreground/60 h-2 rounded" style={{ width: `${(day.uploads / peak) * 100}%` }} />
              </div>
              <span className="text-muted-foreground tabular-nums">导 {day.exports} · 投 {day.uploads}</span>
            </div>
          ))}
        </CardContent>
      </Card>
      <Tabs defaultValue="exports">
        <TabsList>
          <TabsTrigger value="exports">导出</TabsTrigger>
          <TabsTrigger value="uploads">投稿</TabsTrigger>
        </TabsList>
        <TabsContent value="exports"><DataTable columns={exportColumns} data={exports.data ?? []} empty="没有导出记录" /></TabsContent>
        <TabsContent value="uploads"><DataTable columns={uploadColumns} data={uploads.data ?? []} empty="没有投稿记录" /></TabsContent>
      </Tabs>
    </>
  );
}
```

- [ ] **Step 2: `routes/settings.tsx`**

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmButton } from "@/components/confirm-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

type Field = { key: string; label: string; hint?: string; kind: "number" | "text" | "bool" };

const GROUPS: { title: string; fields: Field[] }[] = [
  { title: "并行", fields: [
    { key: "render.maxParallel", label: "同时渲染的任务数", hint: "范围 1–8。多路渲染占用大量内存和 Chrome 进程", kind: "number" },
    { key: "render.frameConcurrency", label: "单个渲染的 --concurrency", hint: "数字或百分比，如 1 或 50%", kind: "text" },
    { key: "bili.maxParallel", label: "同时投稿的任务数", hint: "范围 1–8。大于 1 容易触发 21566", kind: "number" },
  ] },
  { title: "投稿节奏", fields: [
    { key: "upload.minIntervalSec", label: "两次成功投稿的最小间隔（秒）", hint: "AGENTS.md 要求至少 180", kind: "number" },
    { key: "season.writeIntervalSec", label: "合集和草稿写操作的间隔（秒）", hint: "至少 3", kind: "number" },
  ] },
  { title: "限流后的等待", fields: [
    { key: "retry.rateLimitWaitSec", label: "21566 后等待（秒）", kind: "number" },
    { key: "retry.editBusyWaitSec", label: "20111 / 256000 后等待（秒）", kind: "number" },
    { key: "retry.notFoundWaitSec", label: "新稿件加合集返回 -404 后等待（秒）", kind: "number" },
  ] },
  { title: "空闲调度", fields: [
    { key: "idle.enabled", label: "启用空闲自动投稿", kind: "bool" },
    { key: "idle.nightStartHour", label: "夜间窗口开始（时）", kind: "number" },
    { key: "idle.nightEndHour", label: "夜间窗口结束（时，不含）", kind: "number" },
    { key: "idle.lockMinutes", label: "锁屏满多少分钟算空闲", kind: "number" },
    { key: "idle.tickSec", label: "检查间隔（秒）", kind: "number" },
  ] },
  { title: "其他", fields: [
    { key: "draft.capacity", label: "草稿箱容量", kind: "number" },
    { key: "log.maxLinesPerJob", label: "每个任务最多保留的日志行数", kind: "number" },
    { key: "bin.biliup", label: "biliup 可执行文件", kind: "text" },
    { key: "bin.ffmpeg", label: "ffmpeg 可执行文件", kind: "text" },
  ] },
];

function SettingsPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const query = useQuery(trpc.settings.get.queryOptions());
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  useEffect(() => { if (query.data) setDraft(query.data.values); }, [query.data]);

  const done = (message: string) => ({
    onSuccess: () => {
      toast.success(message);
      void queryClient.invalidateQueries({ queryKey: trpc.settings.pathKey() });
      void queryClient.invalidateQueries({ queryKey: trpc.overview.pathKey() });
    },
    onError: (error: { message: string }) => toast.error(error.message),
  });
  const update = useMutation(trpc.settings.update.mutationOptions(done("已保存，runner 下一个轮询周期生效")));
  const reset = useMutation(trpc.settings.reset.mutationOptions(done("已恢复默认")));

  const data = query.data;
  if (!data) return <p className="text-muted-foreground">加载中…</p>;
  const values = data.values as Record<string, unknown>;
  const defaults = data.defaults as Record<string, unknown>;
  const changed = Object.fromEntries(Object.entries(draft).filter(([key, value]) => value !== values[key]));
  const warningFor = (key: string) => data.warnings.find((warning) => warning.key === key)?.message;

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">设置</h1>
        <div className="flex gap-2">
          <ConfirmButton
            variant="outline" title="全部恢复默认？"
            description="所有设置回到 AGENTS.md 的默认节奏，包括可执行文件路径。"
            confirmLabel="恢复默认" onConfirm={() => reset.mutate({})}
          >
            全部恢复默认
          </ConfirmButton>
          <Button disabled={Object.keys(changed).length === 0 || update.isPending} onClick={() => update.mutate(changed)}>
            保存{Object.keys(changed).length > 0 ? `（${Object.keys(changed).length} 项）` : ""}
          </Button>
        </div>
      </div>
      {GROUPS.map((group) => (
        <Card key={group.title}>
          <CardHeader><CardTitle>{group.title}</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-5">
            {group.fields.map((field) => {
              const value = draft[field.key];
              const warning = warningFor(field.key);
              const different = values[field.key] !== defaults[field.key];
              return (
                <div key={field.key} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor={field.key}>{field.label}</Label>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-xs">默认 {String(defaults[field.key])}</span>
                      {different && (
                        <Button size="sm" variant="ghost" onClick={() => reset.mutate({ keys: [field.key as never] })}>恢复默认</Button>
                      )}
                    </div>
                  </div>
                  {field.kind === "bool" ? (
                    <Switch id={field.key} checked={value === true} onCheckedChange={(checked) => setDraft({ ...draft, [field.key]: checked })} />
                  ) : (
                    <Input
                      id={field.key}
                      className="max-w-sm"
                      value={String(value ?? "")}
                      inputMode={field.kind === "number" ? "numeric" : undefined}
                      onChange={(e) => setDraft({
                        ...draft,
                        [field.key]: field.kind === "number" && e.target.value !== "" && Number.isFinite(Number(e.target.value))
                          ? Number(e.target.value) : e.target.value,
                      })}
                    />
                  )}
                  {field.hint && <p className="text-muted-foreground text-xs">{field.hint}</p>}
                  {warning && <Alert><AlertDescription>{warning}</AlertDescription></Alert>}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </>
  );
}
```

- [ ] **Step 3: 重新生成路由树并类型检查**

先按「路由树」一节的一次性命令重新生成 `routeTree.gen.ts`，再：

Run: `nub exec tsc -p admin`  
Expected: 无输出。

- [ ] **Step 4: Commit**

```console
git add admin/app
git commit -m ":sparkles: feat(admin): 添加历史页和设置页"
```

---

## Task 9: 整体验证

**Files:** 无新增。

- [ ] **Step 1: 全量测试、类型检查、lint**

Run: `node --import ./scripts/register-ts.mjs --test src/**/*.test.ts admin/**/*.test.ts`  
Expected: 全部 pass。

Run: `nub run lint`  
Expected: 无输出（`eslint src && tsc && tsc -p admin`）。

- [ ] **Step 2: 前台起整套，用浏览器走一遍**

Run（前台，用演练库，不碰 `data/`）：`RMV_DB=/tmp/rmv-fe.db nub run admin`  
用浏览器（Cursor 内置浏览器或 `agent-browser`）逐页打开 `http://127.0.0.1:3100`，每页截图确认没有报错、没有空白：

1. `/`：runner 显示在线；环境卡片里 `biliup`/`ffmpeg`/`nub` 都找得到。
2. `/library`：「备料目录」列出 `预处理/` 下的目录；登记一个后，专辑或单曲 Tab 里出现它。
3. 专辑详情：勾选两首，「只导出」入队 → 跳到 `/jobs` 能看到 4 个任务（2 个 export + 2 个 cover），状态实时刷新；其中一个 export 点「取消」并确认，对应的 cover 变成已取消（依赖失败）；点「重试」后 cover 复活。
4. `/jobs/<id>`：日志实时追加；取消需要二次确认。
5. `/releases`：Tab 切换正常；草稿箱计数显示（登录态存在时）或读取失败的原因。
6. `/history`、`/settings`：改一项（例如 `idle.tickSec`）保存，刷新后保持；把 `bili.maxParallel` 改成 2，总览出现警告；点「恢复默认」后警告消失。
7. 终端 Ctrl-C：打印 runner 正在停止，两个子进程都退出，没有残留 `vite`/`nub` 进程（`pgrep -fl "vite|runner/main"`）。

不要在这一步触发真实投稿。

- [ ] **Step 3: 收尾**

```console
rm -f /tmp/rmv-fe.db*
git status --short
```

Expected: 只剩计划内的文件改动；`data/` 没有被提交；`tmp/upload-queue.json` 如果已经迁移过则变成 `tmp/upload-queue.json.imported`（被 `tmp` 忽略，不入库）。
