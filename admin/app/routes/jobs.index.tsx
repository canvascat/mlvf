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
      <div className="flex items-center justify-end gap-2">
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
