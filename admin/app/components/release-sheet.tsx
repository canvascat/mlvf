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
