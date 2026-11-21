import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "./db/client";
import { jobs, releases, runnerState, type JobRow } from "./db/schema";
import { enqueueJob, type NewJob } from "./jobs";
import { decideIdle } from "./runner/idle";
import type { Settings } from "./settings";

const ACTIVE = ["queued", "running", "cancel_requested"] as const;

export async function enqueueIdleJobs(
  db: Db,
  now: number,
  listDraftIds: () => Promise<string[]>,
): Promise<JobRow[]> {
  const busy = db.select({ id: jobs.id }).from(jobs)
    .where(and(eq(jobs.lane, "bili"), inArray(jobs.status, [...ACTIVE]))).get();
  if (busy) return [];

  const rows = db.select().from(releases).orderBy(asc(releases.createdAt), asc(releases.id)).all();
  const drafts = rows.filter((row) => row.status === "draft" && row.draftId);
  const pending = rows.filter((row) =>
    row.status === "pending" && !(row.mode === "overwrite" && !row.bvid));
  const known = new Set(drafts.map((row) => row.draftId));
  const unknown = (await listDraftIds()).filter((id) => !known.has(id));

  const plan: NewJob[] = [
    ...drafts.map((row): NewJob => ({
      kind: "publish_draft",
      trackId: row.trackId ?? undefined,
      releaseId: row.id,
      payload: { releaseId: row.id, draftId: row.draftId },
    })),
    ...unknown.map((draftId): NewJob => ({ kind: "publish_draft", payload: { draftId } })),
    ...pending.map((row): NewJob => ({
      kind: "upload",
      trackId: row.trackId ?? undefined,
      releaseId: row.id,
      payload: { releaseId: row.id },
    })),
  ];
  if (plan.length === 0) return [];

  return db.transaction((tx) => {
    const created: JobRow[] = [];
    for (const job of plan) {
      const previous = created.at(-1);
      created.push(enqueueJob(tx, { ...job, dependsOn: previous ? [previous.id] : [] }, now));
    }
    return created;
  });
}

export type IdleDeps = {
  now: () => number;
  screenLocked: () => Promise<boolean>;
  listDraftIds: () => Promise<string[]>;
};

export function createIdleHook(db: Db, deps: IdleDeps): (settings: Settings) => Promise<void> {
  let nextCheckAt = 0;
  let chain: number[] = [];
  let halted = false;
  return async (settings) => {
    const now = deps.now();
    if (now < nextCheckAt) return;
    nextCheckAt = now + settings["idle.tickSec"] * 1000;

    const state = db.select().from(runnerState).where(eq(runnerState.id, 1)).get();
    const locked = settings["idle.enabled"] ? await deps.screenLocked() : false;
    const decision = decideIdle({
      now,
      enabled: settings["idle.enabled"],
      holdUntil: state?.holdUntil ?? null,
      nightStartHour: settings["idle.nightStartHour"],
      nightEndHour: settings["idle.nightEndHour"],
      lockMinutes: settings["idle.lockMinutes"],
      locked,
      lockedSince: state?.lockedSince ?? null,
    });
    if (decision.lockedSince !== (state?.lockedSince ?? null)) {
      db.update(runnerState).set({ lockedSince: decision.lockedSince })
        .where(eq(runnerState.id, 1)).run();
    }
    if (!decision.idle) {
      halted = false;
      chain = [];
      return;
    }
    if (chain.length > 0) {
      const rows = db.select().from(jobs).where(inArray(jobs.id, chain)).all();
      if (rows.some((row) => (ACTIVE as readonly string[]).includes(row.status))) return;
      // 链里有失败或被级联取消的：这次空闲窗口就停
      if (rows.some((row) => row.status !== "succeeded")) halted = true;
      chain = [];
    }
    if (halted) return;
    chain = (await enqueueIdleJobs(db, now, deps.listDraftIds)).map((job) => job.id);
  };
}
