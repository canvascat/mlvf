import { readdir } from "node:fs/promises";
import path from "node:path";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull, notLike, sql } from "drizzle-orm";
import { z } from "zod";
import { probeAudio, readTrackNumber } from "../../../../src/release/io";
import { albums, releases, tracks } from "../../db/schema";
import { registerPrepareDir } from "../../library";
import { PREPARE_ROOT, assertInside } from "../../paths";
import { publicProcedure, router } from "../init";

const real = notLike(tracks.configPath, "legacy:%");

export const libraryRouter = router({
  albums: publicProcedure.query(({ ctx }) => {
    const rows = ctx.db.select().from(albums).where(eq(albums.archived, false))
      .orderBy(desc(albums.createdAt)).all();
    const exported = ctx.db
      .select({ albumId: tracks.albumId, count: sql<number>`count(*)`.mapWith(Number) })
      .from(tracks).where(eq(tracks.exportStatus, "exported")).groupBy(tracks.albumId).all();
    const exportedBy = new Map(exported.map((row) => [row.albumId, row.count]));
    return rows.map((row) => ({ ...row, exportedCount: exportedBy.get(row.id) ?? 0 }));
  }),

  album: publicProcedure.input(z.object({ id: z.number().int() })).query(({ ctx, input }) => {
    const album = ctx.db.select().from(albums).where(eq(albums.id, input.id)).get();
    if (!album) throw new TRPCError({ code: "NOT_FOUND", message: "找不到专辑" });
    const trackRows = ctx.db.select().from(tracks).where(eq(tracks.albumId, album.id))
      .orderBy(tracks.trackNo).all();
    const ids = trackRows.map((row) => row.id);
    const releaseRows = ids.length
      ? ctx.db.select().from(releases).where(inArray(releases.trackId, ids)).all()
      : [];
    return { album, tracks: trackRows, releases: releaseRows };
  }),

  singles: publicProcedure.query(({ ctx }) => {
    const rows = ctx.db.select().from(tracks).where(and(isNull(tracks.albumId), real))
      .orderBy(desc(tracks.createdAt)).all();
    const ids = rows.map((row) => row.id);
    const releaseRows = ids.length
      ? ctx.db.select().from(releases).where(inArray(releases.trackId, ids)).all()
      : [];
    return { tracks: rows, releases: releaseRows };
  }),

  scan: publicProcedure.query(async ({ ctx }) => {
    const root = PREPARE_ROOT();
    let names: string[];
    try {
      const entries = await readdir(root, { withFileTypes: true });
      names = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const known = new Set(ctx.db.select({ dir: tracks.prepareDir }).from(tracks).all().map((row) => row.dir));
    return names.map((name) => {
      const dir = path.join(root, name);
      return { name, dir, registered: known.has(dir) };
    });
  }),

  register: publicProcedure.input(z.object({ dir: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    const dir = assertInside(PREPARE_ROOT(), input.dir);
    try {
      return await registerPrepareDir(ctx.db, dir, { readTrackNumber, probe: probeAudio });
    } catch (error) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }),

  archive: publicProcedure
    .input(z.object({ id: z.number().int(), archived: z.boolean() }))
    .mutation(({ ctx, input }) => {
      ctx.db.update(albums).set({ archived: input.archived }).where(eq(albums.id, input.id)).run();
      return { ok: true };
    }),
});
