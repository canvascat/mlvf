import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { listReleaseTracks } from "../../src/release/order";
import type { Db } from "./db/client";
import { albums, tracks, type AlbumRow, type TrackRow } from "./db/schema";

export type AudioProbe = {
  lossless: boolean;
  sampleRate: number;
  bitsPerSample: number;
  durationSec: number | null;
};

export type RegisterDeps = {
  readTrackNumber: (audioPath: string) => Promise<number | null>;
  probe: (audioPath: string) => Promise<AudioProbe>;
};

type TrackJson = {
  coverImageUrl?: string;
  composer?: string;
  year?: number;
  genre?: string;
  lyricOffsetMs?: number;
  durationInSeconds?: number;
  match?: { lyricSource?: string; lyricFormat?: string };
};

/**
 * 把备料目录登记入库。多首算专辑；只有一首当单曲（album_id 为空，不建专辑行）。
 * 可重复调用：按 config_path 和 prepare_dir 更新，不会重复建行。
 */
export async function registerPrepareDir(
  db: Db,
  dir: string,
  deps: RegisterDeps,
  now: number = Date.now(),
): Promise<{ album: AlbumRow | null; tracks: TrackRow[] }> {
  const prepareDir = path.resolve(dir);
  const listed = await listReleaseTracks(prepareDir, deps.readTrackNumber);
  const first = listed[0];
  if (!first) throw new Error(`备料目录里没有曲目 json: ${prepareDir}`);
  const details = await Promise.all(listed.map(async (track) => ({
    track,
    json: JSON.parse(await readFile(track.configPath, "utf8")) as TrackJson,
    probe: await deps.probe(track.audioPath),
  })));
  const coverOf = (json: TrackJson) =>
    json.coverImageUrl ? path.join(prepareDir, json.coverImageUrl) : null;
  const firstJson = details[0]?.json;

  return db.transaction((tx) => {
    let album: AlbumRow | null = null;
    if (listed.length > 1) {
      const values = {
        title: first.albumName,
        artist: first.artistName,
        year: firstJson?.year ?? null,
        genre: firstJson?.genre ?? null,
        coverPath: firstJson ? coverOf(firstJson) : null,
        trackCount: listed.length,
      };
      tx.insert(albums).values({ prepareDir, ...values, createdAt: now })
        .onConflictDoUpdate({ target: albums.prepareDir, set: values }).run();
      album = tx.select().from(albums).where(eq(albums.prepareDir, prepareDir)).get() ?? null;
    }
    const saved: TrackRow[] = [];
    for (const { track, json, probe } of details) {
      const values = {
        albumId: album?.id ?? null,
        trackNo: track.index,
        prepareDir,
        audioPath: track.audioPath,
        lyricPath: track.lyricPath ?? null,
        coverPath: coverOf(json),
        textPath: track.textPath,
        title: track.songName,
        artist: track.artistName,
        albumTitle: track.albumName,
        composer: json.composer ?? null,
        year: json.year ?? null,
        genre: json.genre ?? null,
        durationSec: probe.durationSec ?? json.durationInSeconds ?? null,
        lyricOffsetMs: json.lyricOffsetMs ?? null,
        lyricSource: json.match?.lyricSource ?? null,
        lyricFormat: json.match?.lyricFormat ?? null,
        audioSampleRate: probe.sampleRate || null,
        audioBits: probe.bitsPerSample || null,
        audioLossless: probe.lossless,
      };
      tx.insert(tracks).values({ configPath: track.configPath, ...values, createdAt: now })
        .onConflictDoUpdate({ target: tracks.configPath, set: values }).run();
      const row = tx.select().from(tracks).where(eq(tracks.configPath, track.configPath)).get();
      if (row) saved.push(row);
    }
    return { album, tracks: saved };
  });
}
