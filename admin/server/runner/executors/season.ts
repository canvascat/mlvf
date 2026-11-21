import { eq } from "drizzle-orm";
import { readTrackNumber } from "../../../../src/release/io";
import { listReleaseTracks } from "../../../../src/release/order";
import { addToSeason, stampSeason } from "../../../../src/release/ops";
import { albums, releases, tracks } from "../../db/schema";
import type { Executor } from "../types";
import { makeReleaseRuntime, requireAlbum } from "./support";

export const seasonExecutor: Executor = async (job, ctx) => {
  const rt = makeReleaseRuntime(ctx);
  const releaseId = typeof job.payload.releaseId === "string" ? job.payload.releaseId : undefined;
  if (releaseId) {
    // 给已经投稿的成片补加入合集
    const item = rt.store.load().items.find((entry) => entry.id === releaseId);
    if (!item) throw new Error(`找不到成片 ${releaseId}`);
    if (item.status !== "done" || !item.bvid) throw new Error("这条还没有投稿完成，没有稿件号");
    if (!item.section_id) {
      const row = ctx.db.select().from(releases).where(eq(releases.id, releaseId)).get();
      const track = row?.trackId != null
        ? ctx.db.select().from(tracks).where(eq(tracks.id, row.trackId)).get()
        : undefined;
      const album = track?.albumId != null
        ? ctx.db.select().from(albums).where(eq(albums.id, track.albumId)).get()
        : undefined;
      if (!album?.seasonId || !album.sectionId) throw new Error("这张专辑还没有建合集，先建合集");
      rt.store.patch(releaseId, (entry) => {
        entry.season_id = album.seasonId ?? undefined;
        entry.section_id = album.sectionId ?? undefined;
      });
      item.section_id = album.sectionId;
    }
    const added = await addToSeason(rt, item, item.bvid);
    rt.store.patch(releaseId, (entry) => { entry.season_added = added; });
    if (!added) throw new Error("加入合集失败，查看日志");
    return { added };
  }
  const album = requireAlbum(ctx.db, job.albumId);
  const listed = await listReleaseTracks(album.prepareDir, readTrackNumber);
  const season = await stampSeason(rt, album.prepareDir, listed);
  ctx.db.update(albums)
    .set({ seasonId: season.seasonId, sectionId: season.sectionId })
    .where(eq(albums.id, album.id))
    .run();
  return season;
};
