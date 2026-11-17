import type { LyricLine } from "@applemusic-like-lyrics/core";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { stripLyricMetadata } from "../helpers/lyric-metadata";
import {
  detectLyricFormat,
  parseLyricText,
  shiftLyricLines,
} from "../helpers/lyrics";
import type {
  AlbumCompositionProps,
  AlbumTrackProps,
  PlayerCompositionProps,
  PlaylistCompositionProps,
  TrackProps,
} from "../helpers/schema";
import { albumSpanInFrames, trackDurationInFrames } from "../helpers/track-duration";
import { ensureProjectTmpDir } from "../lib/project-tmp";
import { loadCueAlbum } from "../prepare/album";
import { isCuePath } from "../prepare/cue";
import { coverExtension } from "../prepare/write-materials";
import { loadPreparedConfig, type ConfigTrack } from "./load-config";
import { collapseSharedSourceAudios, type ConcatAudioInput } from "./mux";
import { UsageError, type ExportArgs } from "./parse-args";
import { defaultOutputPath, losslessOutputPath } from "./timing";

export type ExportJob = {
  publicDir: string;
  ownsPublicDir: boolean;
  outputPath: string;
  fps: number;
  durationInFrames: number;
  sourceAudios: ConcatAudioInput[];
  title: string;
  inputProps:
    | PlayerCompositionProps
    | AlbumCompositionProps
    | PlaylistCompositionProps;
};

function jsonSafeTime(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function jsonSafeLyricLines(lines: LyricLine[]): LyricLine[] {
  return lines.map((line) => ({
    ...line,
    startTime: jsonSafeTime(line.startTime),
    endTime: Number.isFinite(line.endTime)
      ? line.endTime
      : Number.MAX_SAFE_INTEGER,
    words: line.words.map((word) => ({
      ...word,
      startTime: jsonSafeTime(word.startTime),
      endTime: Number.isFinite(word.endTime)
        ? word.endTime
        : Number.MAX_SAFE_INTEGER,
    })),
  }));
}

type MaterializedTrack = {
  track: TrackProps & {
    turntable?: boolean;
    composer?: string;
    year?: number;
    genre?: string;
  };
  sourceAudio: ConcatAudioInput;
  durationInFrames: number;
};

type AssetCache = {
  audio: Map<string, string>;
  cover: Map<string, string>;
};

function createAssetCache(): AssetCache {
  return {
    audio: new Map(),
    cover: new Map(),
  };
}

async function copyOnce(
  cache: Map<string, string>,
  sourcePath: string,
  destDir: string,
  destName: string,
): Promise<string> {
  const key = path.resolve(sourcePath);
  const existing = cache.get(key);
  if (existing) {
    return existing;
  }
  await copyFile(sourcePath, path.join(destDir, destName));
  cache.set(key, destName);
  return destName;
}

function playableEnd(track: ConfigTrack): number {
  const end = track.audioEndInSeconds ?? track.durationInSeconds;
  if (end === undefined || !Number.isFinite(end) || end <= 0) {
    throw new Error(
      `配置缺少 durationInSeconds: ${track.title || track.audioPath}`,
    );
  }
  return end;
}

async function materializeTrack(options: {
  index: number;
  track: ConfigTrack;
  publicDir: string;
  fps: number;
  cache: AssetCache;
  lyrics?: boolean;
}): Promise<MaterializedTrack> {
  const { index, track, publicDir, fps, cache } = options;
  const endSec = playableEnd(track);
  const includeLyrics = options.lyrics !== false && Boolean(track.lyricPath);
  const lyricRaw = includeLyrics ? await readFile(track.lyricPath, "utf8") : "";
  const lyricLines = includeLyrics
    ? parseLyricText(lyricRaw, detectLyricFormat(track.lyricPath))
    : [];

  const prefix = `track-${index}`;
  const audioFileName = await copyOnce(
    cache.audio,
    track.audioPath,
    publicDir,
    `audio-${cache.audio.size}${path.extname(track.audioPath) || ".bin"}`,
  );

  let lyricFileName = "";
  if (includeLyrics) {
    lyricFileName = `${prefix}-lyric${path.extname(track.lyricPath) || ".txt"}`;
    await copyFile(track.lyricPath, path.join(publicDir, lyricFileName));
  }

  let coverFileName = "";
  if (track.coverPath) {
    coverFileName = await copyOnce(
      cache.cover,
      track.coverPath,
      publicDir,
      `cover-${cache.cover.size}${path.extname(track.coverPath) || ".jpg"}`,
    );
  }

  return {
    track: {
      audioOffsetInSeconds: track.offsetInSeconds,
      audioEndInSeconds: track.audioEndInSeconds,
      audioFileUrl: audioFileName,
      lyricsFileUrl: lyricFileName,
      coverImageUrl: coverFileName,
      songName: track.title ?? "",
      artistName: track.artist ?? "",
      albumName: track.album ?? "",
      durationInSeconds: endSec,
      lyricOffsetMs: track.lyricOffsetMs,
      lyricLines: jsonSafeLyricLines(lyricLines),
      ...(track.turntable ? { turntable: true } : {}),
      ...(track.composer ? { composer: track.composer } : {}),
      ...(track.year ? { year: track.year } : {}),
      ...(track.genre ? { genre: track.genre } : {}),
    },
    sourceAudio: {
      path: track.audioPath,
      offsetInSeconds: track.offsetInSeconds,
      durationInSeconds: endSec,
    },
    durationInFrames: trackDurationInFrames(
      endSec,
      track.offsetInSeconds,
      fps,
      track.audioEndInSeconds,
    ),
  };
}

function sourceAudiosForJob(items: MaterializedTrack[]): ConcatAudioInput[] {
  return collapseSharedSourceAudios(items.map((item) => item.sourceAudio));
}

function albumTracksFrom(items: MaterializedTrack[]): AlbumTrackProps[] {
  return items.map((item) => ({
    songName: item.track.songName,
    audioOffsetInSeconds: item.track.audioOffsetInSeconds,
    audioEndInSeconds: item.track.audioEndInSeconds ?? item.track.durationInSeconds,
  }));
}

function albumPropsFrom(items: MaterializedTrack[]): AlbumCompositionProps {
  const shared = items[0]?.track;
  if (!shared) {
    throw new UsageError("专辑至少需要一首歌");
  }
  return {
    audioFileUrl: shared.audioFileUrl,
    coverImageUrl: shared.coverImageUrl || undefined,
    artistName: shared.artistName,
    albumName: shared.albumName,
    tracks: albumTracksFrom(items),
  };
}

function singleTrackProps(
  items: MaterializedTrack[],
  background: ExportArgs["background"],
): PlayerCompositionProps {
  const single = items[0];
  if (!single || items.length !== 1) {
    throw new UsageError("AMLLPlayer 只支持单曲");
  }
  return {
    ...single.track,
    backgroundMotion: background ?? "slow",
  };
}

async function prepareCueExportJob(args: ExportArgs): Promise<ExportJob> {
  if (!args.config) {
    throw new Error("需要 CUE 文件");
  }

  if (args.background) {
    console.log("专辑背景是封面模糊，已忽略 --background");
  }
  const album = await loadCueAlbum({ cuePath: path.resolve(args.config) });
  const publicDir = await mkdtemp(
    path.join(await ensureProjectTmpDir(), "rmv-export-"),
  );
  const cache = createAssetCache();
  const audioFileName = await copyOnce(
    cache.audio,
    album.audioPath,
    publicDir,
    `audio-0${path.extname(album.audioPath) || ".bin"}`,
  );

  let coverFileName = "";
  if (album.coverPath) {
    coverFileName = await copyOnce(
      cache.cover,
      album.coverPath,
      publicDir,
      `cover-0${path.extname(album.coverPath) || ".jpg"}`,
    );
  } else if (album.cover) {
    coverFileName = `cover-0${coverExtension(album.cover.mimeType)}`;
    await writeFile(path.join(publicDir, coverFileName), album.cover.data);
  }

  const first = album.tracks[0];
  const last = album.tracks[album.tracks.length - 1];
  const title = album.albumName || first?.songName || "untitled";
  const inputProps: AlbumCompositionProps = {
    audioFileUrl: audioFileName,
    coverImageUrl: coverFileName || undefined,
    artistName: album.artistName,
    albumName: album.albumName,
    tracks: album.tracks,
  };

  return {
    publicDir,
    ownsPublicDir: true,
    title,
    fps: args.fps,
    durationInFrames: Math.max(1, albumSpanInFrames(album.tracks, args.fps)),
    outputPath: losslessOutputPath(args.out ?? defaultOutputPath(title)),
    sourceAudios: [
      {
        path: album.audioPath,
        offsetInSeconds: first?.audioOffsetInSeconds ?? 0,
        durationInSeconds: last?.audioEndInSeconds ?? 0,
      },
    ],
    inputProps,
  };
}

/**
 * 歌单：每首歌自带封面和歌词，用 PlaylistPlayer 画海报墙。
 * 没有歌词的曲目（纯音乐）歌词留空，画面里只显示封面和歌名。
 */
async function preparePlaylistExportJob(args: ExportArgs): Promise<ExportJob> {
  if (!args.config) {
    throw new Error("需要歌单配置文件");
  }
  if (args.background) {
    console.log("歌单画面没有动态背景，已忽略 --background");
  }
  const loaded = await loadPreparedConfig(args.config, { lyrics: true });
  const publicDir = await mkdtemp(
    path.join(await ensureProjectTmpDir(), "rmv-export-"),
  );
  const cache = createAssetCache();
  const materialized: MaterializedTrack[] = [];
  for (const [index, track] of loaded.tracks.entries()) {
    materialized.push(
      await materializeTrack({
        index,
        track,
        publicDir,
        fps: args.fps,
        cache,
      }),
    );
  }

  // PlaylistPlayer 对已带歌词的曲目不会再处理偏移和署名行，这里先按 Studio 里的结果处理好
  const tracks: TrackProps[] = materialized.map(({ track }) => ({
    ...track,
    lyricOffsetMs: 0,
    lyricLines: stripLyricMetadata(
      shiftLyricLines(track.lyricLines ?? [], track.lyricOffsetMs ?? 0),
      { title: track.songName, artists: track.artistName },
    ),
  }));

  // 画面按整帧切歌（向下取整），音轨也裁到同样的帧数，避免几十首累积出音画错位
  const sourceAudios: ConcatAudioInput[] = materialized.map((item) => ({
    path: item.sourceAudio.path,
    offsetInSeconds: item.sourceAudio.offsetInSeconds,
    durationInSeconds:
      item.sourceAudio.offsetInSeconds + item.durationInFrames / args.fps,
  }));

  return {
    publicDir,
    ownsPublicDir: true,
    title: loaded.title,
    fps: args.fps,
    durationInFrames: Math.max(
      1,
      materialized.reduce((sum, item) => sum + item.durationInFrames, 0),
    ),
    outputPath: losslessOutputPath(args.out ?? defaultOutputPath(loaded.title)),
    sourceAudios,
    inputProps: { tracks },
  };
}

export async function prepareSingleTrackExportJob(
  args: ExportArgs,
  publicDir: string,
): Promise<ExportJob> {
  if (!args.config) {
    throw new Error("需要配置文件");
  }
  const loaded = await loadPreparedConfig(args.config, { lyrics: true });
  if (loaded.tracks.length !== 1) {
    throw new UsageError(
      `单曲预览只支持 1 首，这份配置有 ${loaded.tracks.length} 首`,
    );
  }
  await mkdir(publicDir, { recursive: true });
  const cache = createAssetCache();
  const materialized = await materializeTrack({
    index: 0,
    track: loaded.tracks[0]!,
    publicDir,
    fps: args.fps,
    cache,
    lyrics: true,
  });
  return {
    publicDir,
    ownsPublicDir: false,
    title: loaded.title,
    fps: args.fps,
    durationInFrames: Math.max(1, materialized.durationInFrames),
    outputPath: losslessOutputPath(
      args.out ?? defaultOutputPath(loaded.title),
    ),
    sourceAudios: [materialized.sourceAudio],
    inputProps: singleTrackProps([materialized], args.background),
  };
}

export async function prepareExportJob(args: ExportArgs): Promise<ExportJob> {
  if (!args.config) {
    throw new Error("需要配置文件");
  }
  if (args.playlist) {
    return preparePlaylistExportJob(args);
  }
  if (isCuePath(args.config)) {
    return prepareCueExportJob(args);
  }

  const loaded = await loadPreparedConfig(args.config, { lyrics: !args.album });
  if (!args.album && loaded.tracks.length !== 1) {
    throw new UsageError(
      `AMLLPlayer 只支持单曲，这份配置有 ${loaded.tracks.length} 首。整轨专辑请加上 --album，或直接传入 .cue`,
    );
  }
  const publicDir = await mkdtemp(
    path.join(await ensureProjectTmpDir(), "rmv-export-"),
  );
  const cache = createAssetCache();
  const materialized: MaterializedTrack[] = [];
  for (const [index, track] of loaded.tracks.entries()) {
    materialized.push(
      await materializeTrack({
        index,
        track,
        publicDir,
        fps: args.fps,
        cache,
        lyrics: !args.album,
      }),
    );
  }
  if (args.album && args.background) {
    console.log("专辑背景是封面模糊，已忽略 --background");
  }
  const albumTracks = args.album ? albumTracksFrom(materialized) : [];
  const durationInFrames = args.album
    ? albumSpanInFrames(albumTracks, args.fps)
    : materialized.reduce((sum, item) => sum + item.durationInFrames, 0);

  return {
    publicDir,
    ownsPublicDir: true,
    title: loaded.title,
    fps: args.fps,
    durationInFrames: Math.max(1, durationInFrames),
    outputPath: losslessOutputPath(args.out ?? defaultOutputPath(loaded.title)),
    sourceAudios: sourceAudiosForJob(materialized),
    inputProps: args.album
      ? albumPropsFrom(materialized)
      : singleTrackProps(materialized, args.background),
  };
}

export async function ensureOutputDir(outputPath: string): Promise<void> {
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
}
