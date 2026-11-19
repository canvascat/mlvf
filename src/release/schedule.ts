export const UPLOAD_GAP_MS = 180_000;

export type ScheduleState = {
  mode: "then" | "and";
  exportDone: boolean;
  uploading: boolean;
  now: number;
  lastUploadOkAt: number | null;
  pendingReady: string[];
};

export type ScheduleDecision =
  | { type: "upload"; id: string }
  | { type: "wait"; ms: number }
  | { type: "idle" }
  | { type: "stop" };

export function nextUpload(state: ScheduleState): ScheduleDecision {
  if (state.mode === "then" && !state.exportDone) return { type: "idle" };
  if (state.uploading) return { type: "idle" };
  const next = state.pendingReady[0];
  if (!next) return state.exportDone ? { type: "stop" } : { type: "idle" };
  if (state.lastUploadOkAt != null) {
    const elapsed = state.now - state.lastUploadOkAt;
    if (elapsed < UPLOAD_GAP_MS) {
      return { type: "wait", ms: UPLOAD_GAP_MS - elapsed };
    }
  }
  return { type: "upload", id: next };
}
