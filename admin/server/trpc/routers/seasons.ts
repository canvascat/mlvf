import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { listSeasons } from "../../../../src/release/io";
import { jobs } from "../../db/schema";
import { enqueueJob } from "../../jobs";
import { publicProcedure, router } from "../init";

const ACTIVE = ["queued", "running", "cancel_requested"] as const;

export const seasonsRouter = router({
  list: publicProcedure.query(async () => {
    try {
      return { ok: true as const, seasons: await listSeasons() };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  }),

  ensureForAlbum: publicProcedure.input(z.object({ albumId: z.number().int() })).mutation(({ ctx, input }) => {
    const busy = ctx.db.select({ id: jobs.id }).from(jobs).where(and(
      eq(jobs.kind, "season"), eq(jobs.albumId, input.albumId), inArray(jobs.status, [...ACTIVE]),
    )).get();
    if (busy) throw new TRPCError({ code: "BAD_REQUEST", message: "这张专辑已有进行中的合集任务" });
    return enqueueJob(ctx.db, { kind: "season", albumId: input.albumId });
  }),

  addRelease: publicProcedure.input(z.object({ releaseId: z.string() })).mutation(({ ctx, input }) => {
    const busy = ctx.db.select({ id: jobs.id }).from(jobs).where(and(
      eq(jobs.kind, "season"), eq(jobs.releaseId, input.releaseId), inArray(jobs.status, [...ACTIVE]),
    )).get();
    if (busy) throw new TRPCError({ code: "BAD_REQUEST", message: "这条已有进行中的加入合集任务" });
    return enqueueJob(ctx.db, {
      kind: "season", releaseId: input.releaseId, payload: { releaseId: input.releaseId },
    });
  }),
});
