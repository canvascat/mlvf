import { Badge } from "@/components/ui/badge";
import { jobStatusLabel } from "@/lib/format";

const JOB_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  queued: "outline",
  running: "default",
  succeeded: "secondary",
  failed: "destructive",
  cancel_requested: "outline",
  cancelled: "outline",
  interrupted: "destructive",
};

export function JobStatusBadge({ status }: { status: string }) {
  return <Badge variant={JOB_VARIANT[status] ?? "outline"}>{jobStatusLabel(status)}</Badge>;
}

const RELEASE_LABEL: Record<string, string> = { pending: "待投稿", draft: "草稿", done: "已投稿" };
const RELEASE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  pending: "outline", draft: "default", done: "secondary",
};

export function ReleaseStatusBadge({ status }: { status: string }) {
  return <Badge variant={RELEASE_VARIANT[status] ?? "outline"}>{RELEASE_LABEL[status] ?? status}</Badge>;
}
