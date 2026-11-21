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
      <div className="flex items-center justify-end gap-2">
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
