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
