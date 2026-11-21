import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmButton } from "@/components/confirm-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

type Field = { key: string; label: string; hint?: string; kind: "number" | "text" | "bool" };

const GROUPS: { title: string; fields: Field[] }[] = [
  { title: "并行", fields: [
    { key: "render.maxParallel", label: "同时渲染的任务数", hint: "范围 1–8。多路渲染占用大量内存和 Chrome 进程", kind: "number" },
    { key: "render.frameConcurrency", label: "单个渲染的 --concurrency", hint: "数字或百分比，如 1 或 50%", kind: "text" },
    { key: "bili.maxParallel", label: "同时投稿的任务数", hint: "范围 1–8。大于 1 容易触发 21566", kind: "number" },
  ] },
  { title: "投稿节奏", fields: [
    { key: "upload.minIntervalSec", label: "两次成功投稿的最小间隔（秒）", hint: "AGENTS.md 要求至少 180", kind: "number" },
    { key: "season.writeIntervalSec", label: "合集和草稿写操作的间隔（秒）", hint: "至少 3", kind: "number" },
  ] },
  { title: "限流后的等待", fields: [
    { key: "retry.rateLimitWaitSec", label: "21566 后等待（秒）", kind: "number" },
    { key: "retry.editBusyWaitSec", label: "20111 / 256000 后等待（秒）", kind: "number" },
    { key: "retry.notFoundWaitSec", label: "新稿件加合集返回 -404 后等待（秒）", kind: "number" },
  ] },
  { title: "空闲调度", fields: [
    { key: "idle.enabled", label: "启用空闲自动投稿", kind: "bool" },
    { key: "idle.nightStartHour", label: "夜间窗口开始（时）", kind: "number" },
    { key: "idle.nightEndHour", label: "夜间窗口结束（时，不含）", kind: "number" },
    { key: "idle.lockMinutes", label: "锁屏满多少分钟算空闲", kind: "number" },
    { key: "idle.tickSec", label: "检查间隔（秒）", kind: "number" },
  ] },
  { title: "其他", fields: [
    { key: "draft.capacity", label: "草稿箱容量", kind: "number" },
    { key: "log.maxLinesPerJob", label: "每个任务最多保留的日志行数", kind: "number" },
    { key: "bin.biliup", label: "biliup 可执行文件", kind: "text" },
    { key: "bin.ffmpeg", label: "ffmpeg 可执行文件", kind: "text" },
  ] },
];

function SettingsPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const query = useQuery(trpc.settings.get.queryOptions());
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  useEffect(() => { if (query.data) setDraft(query.data.values); }, [query.data]);

  const done = (message: string) => ({
    onSuccess: () => {
      toast.success(message);
      void queryClient.invalidateQueries({ queryKey: trpc.settings.pathKey() });
      void queryClient.invalidateQueries({ queryKey: trpc.overview.pathKey() });
    },
    onError: (error: { message: string }) => toast.error(error.message),
  });
  const update = useMutation(trpc.settings.update.mutationOptions(done("已保存，runner 下一个轮询周期生效")));
  const reset = useMutation(trpc.settings.reset.mutationOptions(done("已恢复默认")));

  const data = query.data;
  if (!data) return <p className="text-muted-foreground">加载中…</p>;
  const values = data.values as Record<string, unknown>;
  const defaults = data.defaults as Record<string, unknown>;
  const changed = Object.fromEntries(Object.entries(draft).filter(([key, value]) => value !== values[key]));
  const warningFor = (key: string) => data.warnings.find((warning) => warning.key === key)?.message;

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">设置</h1>
        <div className="flex gap-2">
          <ConfirmButton
            variant="outline" title="全部恢复默认？"
            description="所有设置回到 AGENTS.md 的默认节奏，包括可执行文件路径。"
            confirmLabel="恢复默认" onConfirm={() => reset.mutate({})}
          >
            全部恢复默认
          </ConfirmButton>
          <Button disabled={Object.keys(changed).length === 0 || update.isPending} onClick={() => update.mutate(changed)}>
            保存{Object.keys(changed).length > 0 ? `（${Object.keys(changed).length} 项）` : ""}
          </Button>
        </div>
      </div>
      {GROUPS.map((group) => (
        <Card key={group.title}>
          <CardHeader><CardTitle>{group.title}</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-5">
            {group.fields.map((field) => {
              const value = draft[field.key];
              const warning = warningFor(field.key);
              const different = values[field.key] !== defaults[field.key];
              return (
                <div key={field.key} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor={field.key}>{field.label}</Label>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-xs">默认 {String(defaults[field.key])}</span>
                      {different && (
                        <Button size="sm" variant="ghost" onClick={() => reset.mutate({ keys: [field.key as never] })}>恢复默认</Button>
                      )}
                    </div>
                  </div>
                  {field.kind === "bool" ? (
                    <Switch id={field.key} checked={value === true} onCheckedChange={(checked) => setDraft({ ...draft, [field.key]: checked })} />
                  ) : (
                    <Input
                      id={field.key}
                      className="max-w-sm"
                      value={String(value ?? "")}
                      inputMode={field.kind === "number" ? "numeric" : undefined}
                      onChange={(e) => setDraft({
                        ...draft,
                        [field.key]: field.kind === "number" && e.target.value !== "" && Number.isFinite(Number(e.target.value))
                          ? Number(e.target.value) : e.target.value,
                      })}
                    />
                  )}
                  {field.hint && <p className="text-muted-foreground text-xs">{field.hint}</p>}
                  {warning && <Alert><AlertDescription>{warning}</AlertDescription></Alert>}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </>
  );
}
