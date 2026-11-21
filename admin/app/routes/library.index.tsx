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
