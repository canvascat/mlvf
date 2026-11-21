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
