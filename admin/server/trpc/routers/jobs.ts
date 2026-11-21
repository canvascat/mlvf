import { existsSync } from "node:fs";
import path from "node:path";
import { TRPCError, tracked } from "@trpc/server";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { pollJobChanges, pollLogs } from "../../changes";
import { JOB_KINDS, JOB_STATUSES, jobs } from "../../db/schema";
import { getJob, listLogs, requestCancel, retryJob, enqueueJob } from "../../jobs";
import { planExport } from "../../orchestrate";
import { publicProcedure, router } from "../init";
import { withLabels } from "./labels";

const AUDIO_EXT = new Set([".flac", ".wav", ".m4a", ".mp3", ".ape", ".wv", ".cue", ".ogg", ".opus", ".aac"]);

function fail(error: unknown): never {
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: error instanceof Error ? error.message : String(error),
  });
}

export const jobsRouter = router({
  list: publicProcedure
    .input(z.object({
      status: z.array(z.enum(JOB_STATUSES)).optional(),
      kind: z.enum(JOB_KINDS).optional(),
      albumId: z.number().int().optional(),
      trackId: z.number().int().optional(),
      releaseId: z.string().optional(),
      before: z.number().int().optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }))
    .query(({ ctx, input }) => {
      const rows = ctx.db.select().from(jobs).where(and(
        input.status ? inArray(jobs.status, input.status) : undefined,
        input.kind ? eq(jobs.kind, input.kind) : undefined,
        input.albumId != null ? eq(jobs.albumId, input.albumId) : undefined,
        input.trackId != null ? eq(jobs.trackId, input.trackId) : undefined,
        input.releaseId ? eq(jobs.releaseId, input.releaseId) : undefined,
        input.before != null ? lt(jobs.id, input.before) : undefined,
      )).orderBy(desc(jobs.id)).limit(input.limit).all();
      return {
        rows: withLabels(ctx.db, rows),
        nextBefore: rows.length === input.limit ? rows.at(-1)?.id ?? null : null,
      };
    }),

  get: publicProcedure.input(z.object({ id: z.number().int() })).query(({ ctx, input }) => {
    const job = getJob(ctx.db, input.id);
    if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "找不到任务" });
    const upstream = job.dependsOn.length
      ? ctx.db.select().from(jobs).where(inArray(jobs.id, job.dependsOn)).all()
      : [];
    const downstream = ctx.db.select().from(jobs).where(sql`EXISTS (
      SELECT 1 FROM json_each(${jobs.dependsOn}) AS d WHERE d.value = ${job.id})`).all();
    const [labeled] = withLabels(ctx.db, [job]);
    return { job: labeled!, upstream: withLabels(ctx.db, upstream), downstream: withLabels(ctx.db, downstream) };
  }),

  logs: publicProcedure
    .input(z.object({ id: z.number().int(), afterId: z.number().int().default(0), limit: z.number().int().min(1).max(2000).default(500) }))
    .query(({ ctx, input }) => listLogs(ctx.db, input.id, input.afterId, input.limit)),

  enqueueExport: publicProcedure
    .input(z.object({
      mode: z.enum(["export", "export-then-upload", "export-and-upload"]),
      albumId: z.number().int().optional(),
      trackIds: z.array(z.number().int()).optional(),
      overwriteVideo: z.boolean().optional(),
    }))
    .mutation(({ ctx, input }) => {
      try {
        return planExport(ctx.db, input);
      } catch (error) {
        return fail(error);
      }
    }),

  enqueuePrepare: publicProcedure
    .input(z.object({
      audio: z.string().min(1),
      out: z.string().optional(),
      title: z.string().optional(),
      artist: z.string().optional(),
      album: z.string().optional(),
      lyricOffsetMs: z.number().int().optional(),
      acceptEdgeCredits: z.boolean().optional(),
      lyricFormat: z.enum(["krc", "ttml", "yrc", "qrc", "lys", "lrc"]).optional(),
    }))
    .mutation(({ ctx, input }) => {
      if (!path.isAbsolute(input.audio)) fail(new Error("音频需要绝对路径"));
      if (!existsSync(input.audio)) fail(new Error(`音频不存在: ${input.audio}`));
      if (!AUDIO_EXT.has(path.extname(input.audio).toLowerCase())) {
        fail(new Error("只接受音频文件或 .cue"));
      }
      return enqueueJob(ctx.db, { kind: "prepare", payload: input });
    }),

  cancel: publicProcedure.input(z.object({ id: z.number().int() })).mutation(({ ctx, input }) => ({
    result: requestCancel(ctx.db, input.id, Date.now()),
  })),

  retry: publicProcedure.input(z.object({ id: z.number().int() })).mutation(({ ctx, input }) => {
    try {
      return retryJob(ctx.db, input.id, Date.now());
    } catch (error) {
      return fail(error);
    }
  }),

  /** 只推变化了的任务 id；前端据此让相关查询失效重取。 */
  subscribe: publicProcedure.subscription(async function* ({ ctx, signal }) {
    const stop = signal ?? new AbortController().signal;
    for await (const batch of pollJobChanges(ctx.db, stop, { since: Date.now() })) {
      yield tracked(String(batch.at(-1)?.updatedAt ?? 0), batch.map((row) => row.id));
    }
  }),

  subscribeLogs: publicProcedure
    .input(z.object({ jobId: z.number().int(), afterId: z.number().int().default(0) }))
    .subscription(async function* ({ ctx, input, signal }) {
      const stop = signal ?? new AbortController().signal;
      for await (const rows of pollLogs(ctx.db, input.jobId, input.afterId, stop)) {
        yield tracked(String(rows.at(-1)?.id ?? 0), rows);
      }
    }),
});
