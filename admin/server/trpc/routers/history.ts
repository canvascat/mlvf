import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { jobs, releases } from "../../db/schema";
import { toShanghaiIso } from "../../time";
import { publicProcedure, router } from "../init";
import { withLabels } from "./labels";

const DAY = 86_400_000;

export const historyRouter = router({
  exports: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }))
    .query(({ ctx, input }) => {
      const rows = ctx.db.select().from(jobs)
        .where(and(eq(jobs.kind, "export"), inArray(jobs.status, ["succeeded", "failed"])))
        .orderBy(desc(jobs.finishedAt)).limit(input.limit).all();
      return withLabels(ctx.db, rows).map((row) => ({
        ...row,
        durationSec: row.startedAt != null && row.finishedAt != null
          ? Math.round((row.finishedAt - row.startedAt) / 1000)
          : null,
        skipped: (row.result as { skipped?: boolean } | null)?.skipped === true,
      }));
    }),

  uploads: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }))
    .query(({ ctx, input }) =>
      ctx.db.select().from(releases).where(eq(releases.status, "done"))
        .orderBy(desc(releases.finishedAt)).limit(input.limit).all()),

  stats: publicProcedure.query(({ ctx }) => {
    const since = Date.now() - 30 * DAY;
    const exported = ctx.db.select().from(jobs).where(and(
      eq(jobs.kind, "export"), eq(jobs.status, "succeeded"), gte(jobs.finishedAt, since),
    )).all();
    const uploaded = ctx.db.select().from(releases).where(and(
      eq(releases.status, "done"), gte(releases.finishedAt, since),
    )).all();
    const days = new Map<string, { day: string; exports: number; uploads: number }>();
    const touch = (at: number) => {
      const day = toShanghaiIso(at).slice(0, 10);
      const entry = days.get(day) ?? { day, exports: 0, uploads: 0 };
      days.set(day, entry);
      return entry;
    };
    for (const row of exported) if (row.finishedAt != null) touch(row.finishedAt).exports += 1;
    for (const row of uploaded) if (row.finishedAt != null) touch(row.finishedAt).uploads += 1;
    const rendered = exported.filter((row) =>
      row.startedAt != null && row.finishedAt != null
      && (row.result as { skipped?: boolean } | null)?.skipped !== true);
    const avgRenderSec = rendered.length
      ? Math.round(rendered.reduce((sum, row) => sum + (row.finishedAt! - row.startedAt!), 0) / rendered.length / 1000)
      : null;
    return { days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)), avgRenderSec };
  }),
});
