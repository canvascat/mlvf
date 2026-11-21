import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { exportAndEnqueue, outDirFor } from "../../../../src/release/export-batch";
import { probeAudio, readTrackNumber } from "../../../../src/release/io";
import { listReleaseTracks } from "../../../../src/release/order";
import { writeCover } from "../../../../src/release/ops";
import { albums } from "../../db/schema";
import type { Executor } from "../types";
import { makeReleaseRuntime, requireTrack } from "./support";

/** 抽封面并建/更新 releases 行。成片已经由 export 任务渲好，这里不再渲染。 */
export const coverExecutor: Executor = async (job, ctx) => {
  const track = requireTrack(ctx.db, job.trackId);
  const rt = makeReleaseRuntime(ctx);
  const listed = await listReleaseTracks(track.prepareDir, readTrackNumber);
  const target = listed.find(
    (entry) => path.resolve(entry.configPath) === path.resolve(track.configPath),
  );
  if (!target) throw new Error(`找不到配置 ${track.configPath}`);
  const album = track.albumId != null
    ? ctx.db.select().from(albums).where(eq(albums.id, track.albumId)).get()
    : undefined;
  const enqueued: string[] = [];
  await exportAndEnqueue({
    tracks: [target],
    outDir: outDirFor(track.prepareDir),
    prepareDir: track.prepareDir,
    overwriteVideo: false,
    exportVideo: async () => undefined,
    fileExists: () => true,
    probe: probeAudio,
    readText: (file) => readFileSync(file, "utf8"),
    loadQueue: () => rt.store.load(),
    saveQueue: (queue) => rt.store.save(queue),
    onEnqueued: (id) => {
      enqueued.push(id);
      if (album?.seasonId && album.sectionId) {
        rt.store.patch(id, (item) => {
          item.season_id = album.seasonId ?? undefined;
          item.section_id = album.sectionId ?? undefined;
        });
      }
    },
    writeCover: (entry, video, cover) => writeCover(rt, entry, video, cover),
  });
  return { releaseId: enqueued[0] ?? null };
};
