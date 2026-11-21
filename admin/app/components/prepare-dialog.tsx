import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PathInput } from "@/components/path-input";
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
            <PathInput id="audio" kind="file" value={audio} onChange={setAudio} placeholder="/Users/…/半岛铁盒.flac" />
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
