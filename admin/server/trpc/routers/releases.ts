import { TRPCError } from "@trpc/server";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { fetchDrafts } from "../../bili";
import { jobs, releases } from "../../db/schema";
import { enqueueJob } from "../../jobs";
import { activeReleaseJob, planUpload } from "../../orchestrate";
import { getSettings } from "../../settings";
import { publicProcedure, router } from "../init";

function fail(code: "BAD_REQUEST" | "NOT_FOUND", message: string): never {
  throw new TRPCError({ code, message });
}

export const releasesRouter = router({
  list: publicProcedure
    .input(z.object({ status: z.enum(["pending", "draft", "done"]).optional() }))
    .query(({ ctx, input }) => {
      const rows = (input.status
        ? ctx.db.select().from(releases).where(eq(releases.status, input.status))
        : ctx.db.select().from(releases)).orderBy(desc(releases.createdAt)).all();
      const ids = rows.map((row) => row.id);
      const active = ids.length
        ? ctx.db.select().from(jobs)
          .where(inArray(jobs.releaseId, ids)).orderBy(desc(jobs.id)).all()
        : [];
      return rows.map((row) => ({
        ...row,
        activeJob: active.find((job) =>
          job.releaseId === row.id && ["queued", "running", "cancel_requested"].includes(job.status)) ?? null,
        lastJob: active.find((job) => job.releaseId === row.id) ?? null,
      }));
    }),

  get: publicProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    const row = ctx.db.select().from(releases).where(eq(releases.id, input.id)).get();
    if (!row) fail("NOT_FOUND", "找不到成片");
    return row;
  }),

  updateUpload: publicProcedure
    .input(z.object({
      id: z.string(),
      title: z.string().min(1).optional(),
      desc: z.string().optional(),
      tag: z.string().optional(),
      cover: z.string().optional(),
      tid: z.number().int().optional(),
      copyright: z.union([z.literal(1), z.literal(2)]).optional(),
      dynamic: z.string().optional(),
      hires: z.union([z.literal(0), z.literal(1)]).optional(),
    }))
    .mutation(({ ctx, input }) => {
      const row = ctx.db.select().from(releases).where(eq(releases.id, input.id)).get();
      if (!row) fail("NOT_FOUND", "找不到成片");
      if (row.status !== "pending") fail("BAD_REQUEST", "只有 pending 的成片可以改上传信息");
      if (activeReleaseJob(ctx.db, input.id)) fail("BAD_REQUEST", "这条有进行中的投稿任务，先取消再改");
      const set = {
        ...(input.title !== undefined ? { uploadTitle: input.title } : {}),
        ...(input.desc !== undefined ? { uploadDesc: input.desc } : {}),
        ...(input.tag !== undefined ? { uploadTag: input.tag } : {}),
        ...(input.cover !== undefined ? { uploadCover: input.cover } : {}),
        ...(input.tid !== undefined ? { uploadTid: input.tid } : {}),
        ...(input.copyright !== undefined ? { uploadCopyright: input.copyright } : {}),
        ...(input.dynamic !== undefined ? { uploadDynamic: input.dynamic } : {}),
        ...(input.hires !== undefined ? { uploadHires: input.hires } : {}),
      };
      if (Object.keys(set).length === 0) return row;
      return ctx.db.update(releases).set(set).where(eq(releases.id, input.id)).returning().get();
    }),

  enqueueUpload: publicProcedure
    .input(z.object({ ids: z.array(z.string()).min(1) }))
    .mutation(({ ctx, input }) => {
      try {
        return planUpload(ctx.db, { releaseIds: input.ids });
      } catch (error) {
        return fail("BAD_REQUEST", error instanceof Error ? error.message : String(error));
      }
    }),

  remove: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const row = ctx.db.select().from(releases).where(eq(releases.id, input.id)).get();
    if (!row) fail("NOT_FOUND", "找不到成片");
    if (row.status !== "pending") fail("BAD_REQUEST", "只有 pending 的成片可以删除");
    if (activeReleaseJob(ctx.db, input.id)) fail("BAD_REQUEST", "这条有进行中的投稿任务，先取消");
    ctx.db.delete(releases).where(eq(releases.id, input.id)).run();
    return { ok: true };
  }),

  regenCover: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const row = ctx.db.select().from(releases).where(eq(releases.id, input.id)).get();
    if (!row) fail("NOT_FOUND", "找不到成片");
    if (row.status !== "pending") fail("BAD_REQUEST", "只有 pending 的成片可以重新抽封面");
    if (row.trackId == null) fail("BAD_REQUEST", "这条没有关联曲目");
    return enqueueJob(ctx.db, { kind: "cover", trackId: row.trackId, releaseId: row.id });
  }),

  draftBox: publicProcedure.query(async ({ ctx }) => {
    const capacity = getSettings(ctx.db)["draft.capacity"];
    try {
      const items = await fetchDrafts();
      return { ok: true as const, used: items.length, capacity, items };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error), capacity };
    }
  }),
});
