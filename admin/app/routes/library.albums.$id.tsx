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
