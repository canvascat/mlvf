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
