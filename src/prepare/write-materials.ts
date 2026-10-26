import { existsSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  LookupResult,
  PreparedAlbum,
  PreparedAlbumTrack,
  PreparedTrack,
  ResolvedCover,
} from "./types";

const COVER_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif"] as const;
const DIR_COVER_NAMES = ["cover", "folder", "front", "Cover", "Folder", "Front"] as const;

export function coverExtension(mimeType: string | undefined): string {
  if (mimeType?.includes("png")) {
    return ".png";
  }
  if (mimeType?.includes("webp")) {
    return ".webp";
  }
  if (mimeType?.includes("gif")) {
    return ".gif";
  }
  return ".jpg";
}

export function fileStem(filePath: string): string {
  const base = path.basename(filePath);
  const ext = path.extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}

function roundTime(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function isSameFile(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

function toPreparedTrack(
  audioFileUrl: string,
  lyricsFileUrl: string,
  coverImageUrl: string,
  result: LookupResult,
  lyricOffsetMs: number | undefined,
  timing?: { startSeconds: number; endSeconds: number },
): PreparedTrack {
  return {
    audioFileUrl,
    lyricsFileUrl,
    coverImageUrl,
    audioOffsetInSeconds: timing ? roundTime(timing.startSeconds) : 0,
    audioEndInSeconds: timing ? roundTime(timing.endSeconds) : undefined,
    songName: result.songName,
    artistName: result.artistName,
    albumName: result.albumName,
    durationInSeconds: timing
      ? roundTime(timing.endSeconds)
      : result.durationInSeconds,
    lyricOffsetMs,
    match: {
      lyricSource: result.lyric?.source,
      lyricFormat: result.lyric?.format,
      coverSource: result.cover?.source,
    },
  };
}

async function ensureAudioBeside(
  audioPath: string,
  outDir: string,
): Promise<string> {
  const name = path.basename(audioPath);
  const dest = path.join(outDir, name);
  if (!isSameFile(audioPath, dest)) {
    await copyFile(audioPath, dest);
  }
  return name;
}

function existingCoverName(dir: string, stem: string): string | undefined {
  for (const ext of COVER_EXTS) {
    const name = `${stem}${ext}`;
    if (existsSync(path.join(dir, name))) {
      return name;
    }
  }
  for (const name of DIR_COVER_NAMES) {
    for (const ext of COVER_EXTS) {
      const file = `${name}${ext}`;
      if (existsSync(path.join(dir, file))) {
        return file;
      }
    }
  }
  return undefined;
}

async function placeCover(
  outDir: string,
  stem: string,
  cover?: ResolvedCover,
): Promise<string> {
  if (cover) {
    const name = `${stem}${coverExtension(cover.mimeType)}`;
    await writeFile(path.join(outDir, name), cover.data);
    return name;
  }
  return existingCoverName(outDir, stem) ?? "";
}

export async function writeMaterials(options: {
  audioPath: string;
  result: LookupResult;
  outDir?: string;
  /** 人工确认后的偏移，只对这次写出的歌词生效。 */
  lyricOffsetMs?: number;
}): Promise<{
  jsonPath: string;
  prepared: PreparedTrack;
  hasLyrics: boolean;
}> {
  const { audioPath, result } = options;
  const outDir = options.outDir ?? path.dirname(audioPath);
  const stem = fileStem(audioPath);
  await mkdir(outDir, { recursive: true });

  const audioFileUrl = await ensureAudioBeside(audioPath, outDir);

  let lyricsFileUrl = "";
  if (result.lyric) {
    lyricsFileUrl = `${stem}.${result.lyric.format}`;
    await writeFile(path.join(outDir, lyricsFileUrl), result.lyric.content, "utf8");
  }

  const coverImageUrl = await placeCover(outDir, stem, result.cover);

  const prepared = toPreparedTrack(
    audioFileUrl,
    lyricsFileUrl,
    coverImageUrl,
    result,
    options.lyricOffsetMs,
  );
  const jsonPath = path.join(outDir, `${stem}.json`);
  await writeFile(jsonPath, `${JSON.stringify(prepared, null, 2)}\n`, "utf8");

  return {
    jsonPath,
    prepared,
    hasLyrics: Boolean(result.lyric),
  };
}

export async function writeAlbumMaterials(options: {
  audioPath: string;
  albumName: string;
  artistName: string;
  cover?: ResolvedCover;
  tracks: PreparedAlbumTrack[];
  outDir?: string;
}): Promise<{
  jsonPath: string;
  prepared: PreparedAlbum;
}> {
  const { audioPath, cover } = options;
  const outDir = options.outDir ?? path.dirname(audioPath);
  const stem = fileStem(audioPath);
  await mkdir(outDir, { recursive: true });

  const audioFileUrl = await ensureAudioBeside(audioPath, outDir);
  const coverImageUrl = await placeCover(outDir, stem, cover);
  const tracks = options.tracks.map((track) => ({
    songName: track.songName,
    audioOffsetInSeconds: roundTime(track.audioOffsetInSeconds),
    audioEndInSeconds: roundTime(track.audioEndInSeconds),
  }));

  const prepared: PreparedAlbum = {
    albumName: options.albumName,
    artistName: options.artistName,
    audioFileUrl,
    coverImageUrl,
    tracks,
  };
  const jsonPath = path.join(outDir, `${stem}.json`);
  await writeFile(jsonPath, `${JSON.stringify(prepared, null, 2)}\n`, "utf8");

  return { jsonPath, prepared };
}
