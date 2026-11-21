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
