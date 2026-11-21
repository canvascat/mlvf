import { inArray } from "drizzle-orm";
import type { Conn } from "../../db/client";
import { albums, tracks, type JobRow } from "../../db/schema";

export type LabeledJob = JobRow & { trackTitle: string | null; albumTitle: string | null };

export function withLabels(conn: Conn, rows: JobRow[]): LabeledJob[] {
  const trackIds = [...new Set(rows.flatMap((row) => (row.trackId == null ? [] : [row.trackId])))];
  const trackRows = trackIds.length
    ? conn.select().from(tracks).where(inArray(tracks.id, trackIds)).all()
    : [];
  const albumIds = [...new Set([
    ...rows.flatMap((row) => (row.albumId == null ? [] : [row.albumId])),
    ...trackRows.flatMap((row) => (row.albumId == null ? [] : [row.albumId])),
  ])];
  const albumRows = albumIds.length
    ? conn.select().from(albums).where(inArray(albums.id, albumIds)).all()
    : [];
  const trackById = new Map(trackRows.map((row) => [row.id, row]));
  const albumById = new Map(albumRows.map((row) => [row.id, row]));
  return rows.map((row) => {
    const track = row.trackId == null ? undefined : trackById.get(row.trackId);
    const albumId = row.albumId ?? track?.albumId ?? null;
    return {
      ...row,
      trackTitle: track?.title ?? null,
      albumTitle: albumId == null ? null : albumById.get(albumId)?.title ?? null,
    };
  });
}
