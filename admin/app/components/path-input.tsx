import { useMutation } from "@tanstack/react-query";
import { FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type Props = {
  id?: string;
  kind: "file" | "folder";
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
};

/** 路径输入框 + 原生选择器。选择框由服务端在本机弹出，所以拿到的是绝对路径。 */
export function PathInput({ id, kind, value, onChange, placeholder, className }: Props) {
  const trpc = useTRPC();
  const pick = useMutation(trpc.system.pickPath.mutationOptions({
    onSuccess: (result) => { if (result.path) onChange(result.path); },
    onError: (error) => toast.error(error.message),
  }));
  return (
    <div className={cn("flex gap-2", className)}>
      <Input id={id} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <Button
        type="button"
        variant="outline"
        disabled={pick.isPending}
        onClick={() => pick.mutate({ kind, ...(value ? { current: value } : {}) })}
      >
        <FolderOpen />
        {pick.isPending ? "选择中…" : kind === "folder" ? "选择文件夹" : "选择文件"}
      </Button>
    </div>
  );
}
