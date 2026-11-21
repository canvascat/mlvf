import { asc, eq, inArray, sql } from "drizzle-orm";
import { jobs, releases, runnerState } from "../../db/schema";
import { runnerOnline } from "../../runner/lock";
import { getSettings, settingWarnings } from "../../settings";
import { publicProcedure, router } from "../init";
import { withLabels } from "./labels";

export const overviewRouter = router({
  get: publicProcedure.query(({ ctx }) => {
    const now = Date.now();
    const state = ctx.db.select().from(runnerState).where(eq(runnerState.id, 1)).get();
    const jobCounts = ctx.db
      .select({ status: jobs.status, count: sql<number>`count(*)`.mapWith(Number) })
      .from(jobs).groupBy(jobs.status).all();
    const releaseCounts = ctx.db
      .select({ status: releases.status, count: sql<number>`count(*)`.mapWith(Number) })
      .from(releases).groupBy(releases.status).all();
    const running = ctx.db.select().from(jobs)
      .where(inArray(jobs.status, ["running", "cancel_requested"]))
      .orderBy(asc(jobs.id)).all();
    return {
      now,
      runner: { online: runnerOnline(state?.heartbeatAt ?? null, now), pid: state?.pid ?? null },
      state: {
        lockedSince: state?.lockedSince ?? null,
        holdUntil: state?.holdUntil ?? null,
        lastUploadOkAt: state?.lastUploadOkAt ?? null,
      },
      jobCounts: Object.fromEntries(jobCounts.map((row) => [row.status, row.count])) as Record<string, number>,
      releaseCounts: Object.fromEntries(releaseCounts.map((row) => [row.status, row.count])) as Record<string, number>,
      running: withLabels(ctx.db, running),
      warnings: settingWarnings(getSettings(ctx.db)),
    };
  }),
});
