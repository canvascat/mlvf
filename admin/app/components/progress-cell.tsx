import { Progress } from "@/components/ui/progress";

export function ProgressCell({ value, active }: { value: number; active: boolean }) {
  if (!active) return null;
  return (
    <div className="flex items-center gap-2">
      <Progress value={Math.round(value * 100)} className="w-24" />
      <span className="text-muted-foreground text-xs tabular-nums">{Math.round(value * 100)}%</span>
    </div>
  );
}
