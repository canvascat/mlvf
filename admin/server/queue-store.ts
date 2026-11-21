import { existsSync, readFileSync, renameSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import type { QueueItem } from "../../src/release/queue";
import { batchKey, emptyQueue, type QueueFile } from "../../src/release/queue";
import type { QueueStore } from "../../src/release/store";
import type { Conn, Db } from "./db/client";
import { releases, runnerState, tracks, type ReleaseRow } from "./db/schema";
import { fromIso, toShanghaiIso } from "./time";

const ID_PATTERN = /^release-([0-9a-f]{8})-(\d{2})$/;

export function itemFromRow(row: ReleaseRow): QueueItem {
  return {
    id: row.id,
    mode: row.mode,
    status: row.status,
    video: row.video,
    title: row.title,
    created: toShanghaiIso(row.createdAt),
    ...(row.bvid ? { bvid: row.bvid } : {}),
    ...(row.seasonId != null ? { season_id: row.seasonId } : {}),
    ...(row.sectionId != null ? { section_id: row.sectionId } : {}),
    ...(row.seasonAdded != null ? { season_added: row.seasonAdded } : {}),
    ...(row.draftId ? { draft_id: row.draftId } : {}),
    ...(row.finishedAt != null ? { finished: toShanghaiIso(row.finishedAt) } : {}),
    upload: {
      title: row.uploadTitle,
      desc: row.uploadDesc,
      tag: row.uploadTag,
      cover: row.uploadCover,
      tid: row.uploadTid,
      copyright: row.uploadCopyright,
      dynamic: row.uploadDynamic,
      hires: row.uploadHires === 1 ? 1 : 0,
    },
  };
}

function valuesFromItem(item: QueueItem) {
  return {
    mode: item.mode,
    status: item.status,
    video: item.video,
    title: item.title,
    bvid: item.bvid ?? null,
    draftId: item.draft_id ?? null,
    seasonId: item.season_id ?? null,
    sectionId: item.section_id ?? null,
    seasonAdded: item.season_added ?? null,
    uploadTitle: item.upload.title,
    uploadDesc: item.upload.desc,
    uploadTag: item.upload.tag,
    uploadCover: item.upload.cover,
    uploadTid: item.upload.tid,
    uploadCopyright: item.upload.copyright,
    uploadDynamic: item.upload.dynamic ?? "",
    uploadHires: item.upload.hires,
    createdAt: fromIso(item.created),
    finishedAt: item.finished ? fromIso(item.finished) : null,
  };
}

/** 旧队列条目里 44 条带的备料字段，导入时用来建真实曲目。 */
export type LegacyExtras = {
  config?: string;
  song?: string;
  artist?: string;
  album?: string;
  lyrics?: string;
  lyric_offset_ms?: number;
};

function ensureTrackFor(conn: Conn, item: QueueItem & LegacyExtras, now: number): number {
  const found = ID_PATTERN.exec(item.id);
  if (found) {
    const hash = found[1];
    const no = Number(found[2]);
    const hit = conn.select().from(tracks).where(eq(tracks.trackNo, no)).all()
      .find((track) => batchKey(track.prepareDir) === hash);
    if (hit) return hit.id;
  }
  const configPath = item.config ?? `legacy:${item.video}`;
  conn.insert(tracks).values({
    configPath,
    prepareDir: item.config ? path.dirname(item.config) : "",
    audioPath: "",
    lyricPath: item.lyrics ?? null,
    lyricOffsetMs: item.lyric_offset_ms ?? null,
    title: item.song ?? item.title,
    artist: item.artist ?? "",
    albumTitle: item.album ?? "",
    createdAt: now,
  }).onConflictDoNothing().run();
  const row = conn.select().from(tracks).where(eq(tracks.configPath, configPath)).get();
  if (!row) throw new Error(`无法为 ${item.id} 找到或建立曲目`);
  return row.id;
}

export function createDbQueueStore(db: Db): QueueStore {
  /** 每个条目对象记着自己被读出来时的内容，save 时只写和它不同的条目。 */
  const snapshots = new WeakMap<QueueItem, string>();
  const readAll = (conn: Conn): QueueFile => {
    const state = conn.select().from(runnerState).where(eq(runnerState.id, 1)).get();
    const rows = conn.select().from(releases).all()
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const items = rows.map(itemFromRow);
    const queue: QueueFile = {
      ...emptyQueue(),
      locked_since: state?.lockedSince != null ? toShanghaiIso(state.lockedSince) : null,
      hold_until: state?.holdUntil != null ? toShanghaiIso(state.holdUntil) : null,
      items,
    };
    for (const item of items) snapshots.set(item, JSON.stringify(item));
    return queue;
  };
  const currentText = (conn: Conn, id: string): string | undefined => {
    const row = conn.select().from(releases).where(eq(releases.id, id)).get();
    return row ? JSON.stringify(itemFromRow(row)) : undefined;
  };
  const write = (conn: Conn, item: QueueItem): void => {
    const exists = conn.select({ id: releases.id }).from(releases).where(eq(releases.id, item.id)).get();
    if (exists) {
      conn.update(releases).set(valuesFromItem(item)).where(eq(releases.id, item.id)).run();
    } else {
      conn.insert(releases).values({
        id: item.id,
        trackId: ensureTrackFor(conn, item, Date.now()),
        ...valuesFromItem(item),
      }).run();
    }
  };
  return {
    load: () => readAll(db),
    save(queue) {
      db.transaction((tx) => {
        for (const item of queue.items) {
          const text = JSON.stringify(item);
          // 没有快照的是新建的条目（或展开出来的新对象），和库里当前内容比
          const seen = snapshots.get(item) ?? currentText(tx, item.id);
          if (seen === text) continue;
          write(tx, item);
          snapshots.set(item, text);
        }
      });
    },
    patch(id, update) {
      return db.transaction((tx) => {
        const row = tx.select().from(releases).where(eq(releases.id, id)).get();
        if (!row) return undefined;
        const item = itemFromRow(row);
        update(item);
        write(tx, item);
        return item;
      });
    },
  };
}

export type ImportResult = { imported: number; skipped: number };

/** 一次性把 JSON 队列导入数据库。可重复执行：已有 id 不覆盖。 */
export function importQueueJson(db: Db, file: string, now: number = Date.now()): ImportResult {
  if (!existsSync(file)) return { imported: 0, skipped: 0 };
  const data = JSON.parse(readFileSync(file, "utf8")) as QueueFile;
  const result = db.transaction((tx) => {
    let imported = 0;
    let skipped = 0;
    for (const item of data.items as (QueueItem & LegacyExtras)[]) {
      const exists = tx.select({ id: releases.id }).from(releases).where(eq(releases.id, item.id)).get();
      if (exists) { skipped += 1; continue; }
      const sameVideo = tx.select({ id: releases.id }).from(releases)
        .where(and(eq(releases.video, item.video))).get();
      if (sameVideo) { skipped += 1; continue; }
      tx.insert(releases).values({
        id: item.id,
        trackId: ensureTrackFor(tx, item, now),
        ...valuesFromItem(item),
      }).run();
      imported += 1;
    }
    const state = tx.select().from(runnerState).where(eq(runnerState.id, 1)).get();
    if (state && state.lockedSince == null && state.holdUntil == null) {
      tx.update(runnerState).set({
        lockedSince: data.locked_since ? fromIso(data.locked_since) : null,
        holdUntil: data.hold_until ? fromIso(data.hold_until) : null,
      }).where(eq(runnerState.id, 1)).run();
    }
    return { imported, skipped };
  });
  renameSync(file, `${file}.imported`);
  return result;
}
