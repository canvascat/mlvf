import { and, eq, inArray } from "drizzle-orm";
import { outDirFor, videoPathFor } from "../../src/release/export-batch";
import { releaseItemId } from "../../src/release/queue";
import type { Conn, Db } from "./db/client";
import { albums, jobs, releases, tracks, type JobRow, type TrackRow } from "./db/schema";
import { enqueueJob, type NewJob } from "./jobs";

export type ExportMode = "export" | "export-then-upload" | "export-and-upload";

export type PlanExportInput = {
  mode: ExportMode;
  albumId?: number;
  trackIds?: number[];
  overwriteVideo?: boolean;
};

function selectTracks(conn: Conn, input: PlanExportInput): TrackRow[] {
  let rows: TrackRow[];
  if (input.albumId != null) {
    rows = conn.select().from(tracks).where(eq(tracks.albumId, input.albumId)).all();
    if (input.trackIds?.length) {
      const wanted = new Set(input.trackIds);
      rows = rows.filter((row) => wanted.has(row.id));
    }
  } else if (input.trackIds?.length) {
    rows = conn.select().from(tracks).where(inArray(tracks.id, input.trackIds)).all();
  } else {
    throw new Error("需要指定专辑或曲目");
  }
  if (rows.length === 0) throw new Error("没有可导出的曲目");
  for (const row of rows) {
    if (row.configPath.startsWith("legacy:")) {
      throw new Error(`《${row.title}》是旧队列导入的占位曲目，没有备料配置，无法导出`);
    }
  }
  return rows.sort((a, b) => (a.trackNo ?? 0) - (b.trackNo ?? 0) || a.id - b.id);
}

export function planExport(db: Db, input: PlanExportInput, now: number = Date.now()): JobRow[] {
  return db.transaction((tx) => {
    const selected = selectTracks(tx, input);
    const withUpload = input.mode !== "export";
    const created: JobRow[] = [];
    const add = (job: NewJob): JobRow => {
      const row = enqueueJob(tx, job, now);
      created.push(row);
      return row;
    };

    const seasonJobs = new Map<number, JobRow>();
    if (withUpload) {
      const albumIds = [...new Set(selected.flatMap((row) => (row.albumId == null ? [] : [row.albumId])))];
      for (const albumId of albumIds) {
        const album = tx.select().from(albums).where(eq(albums.id, albumId)).get();
        if (album?.seasonId && album.sectionId) continue;
        seasonJobs.set(albumId, add({ kind: "season", albumId }));
      }
    }

    const covers: JobRow[] = [];
    for (const track of selected) {
      const albumId = track.albumId ?? undefined;
      const outPath = videoPathFor(outDirFor(track.prepareDir), track.artist, track.title);
      const exported = add({
        kind: "export",
        trackId: track.id,
        albumId,
        payload: {
          configPath: track.configPath,
          outPath,
          overwriteVideo: Boolean(input.overwriteVideo),
        },
      });
      const season = track.albumId != null ? seasonJobs.get(track.albumId) : undefined;
      covers.push(add({
        kind: "cover",
        trackId: track.id,
        albumId,
        dependsOn: [exported.id, ...(season ? [season.id] : [])],
      }));
    }
    if (!withUpload) return created;

    let previous: JobRow | undefined;
    selected.forEach((track, index) => {
      const releaseId = releaseItemId(track.prepareDir, track.trackNo ?? index + 1);
      const own = covers[index];
      const dependsOn = input.mode === "export-then-upload"
        ? covers.map((cover) => cover.id)
        : own ? [own.id] : [];
      if (previous) dependsOn.push(previous.id);
      previous = add({
        kind: "upload",
        trackId: track.id,
        albumId: track.albumId ?? undefined,
        releaseId,
        dependsOn,
        payload: { releaseId },
      });
    });
    return created;
  });
}

const ACTIVE = ["queued", "running", "cancel_requested"] as const;

export function activeReleaseJob(conn: Conn, releaseId: string): JobRow | undefined {
  return conn.select().from(jobs)
    .where(and(
      eq(jobs.releaseId, releaseId),
      inArray(jobs.kind, ["upload", "publish_draft"]),
      inArray(jobs.status, [...ACTIVE]),
    ))
    .get();
}

export function planUpload(
  db: Db,
  input: { releaseIds: string[] },
  now: number = Date.now(),
): JobRow[] {
  return db.transaction((tx) => {
    const created: JobRow[] = [];
    let previous: JobRow | undefined;
    for (const id of input.releaseIds) {
      const row = tx.select().from(releases).where(eq(releases.id, id)).get();
      if (!row) throw new Error(`找不到成片 ${id}`);
      if (row.status === "done") throw new Error(`《${row.title}》已投稿`);
      if (activeReleaseJob(tx, id)) throw new Error(`《${row.title}》已在队列中`);
      if (row.status === "pending" && row.mode === "overwrite" && !row.bvid) {
        throw new Error(`覆盖投稿缺少稿件号：《${row.title}》`);
      }
      const dependsOn = previous ? [previous.id] : [];
      previous = row.status === "draft"
        ? enqueueJob(tx, {
          kind: "publish_draft",
          trackId: row.trackId ?? undefined,
          releaseId: id,
          dependsOn,
          payload: { releaseId: id, draftId: row.draftId },
        }, now)
        : enqueueJob(tx, {
          kind: "upload",
          trackId: row.trackId ?? undefined,
          releaseId: id,
          dependsOn,
          payload: { releaseId: id },
        }, now);
      created.push(previous);
    }
    return created;
  });
}
