import { titleFromAudioPath } from "../export/timing";
import { parseLyricText } from "../helpers/lyrics";
import { readRmsEnvelope } from "./audio-envelope";
import { LOOKUP_TIMEOUT_MS, fetchBytes, mergeSignals } from "./http";
import { estimateLyricOffsetMs, lyricOnsetTimesMs } from "./lyric-offset";
import { findAlbumCover } from "./album-cover";
import {
  albumNamesMatch,
  buildSearchKeyword,
  lyricMatchesPreference,
  pickBestLyric,
  shouldSearchLyrics,
  type LyricFormatPreference,
} from "./match";
import { overlayAmlTtml } from "./providers/amll-ttml";
import { lookupAppleTtml } from "./providers/apple-ttml";
import { lookupItunes } from "./providers/itunes";
import { lookupKugou } from "./providers/kugou";
import { lookupLrclib } from "./providers/lrclib";
import { lookupNetease } from "./providers/netease";
import { lookupQqMusic } from "./providers/qqmusic";
import { firstNonBlank, readLocalTags, resolveQueryTitle } from "./tags";
import { prepareDisplayText, sanitizeLyric } from "./text-cleanup";
import type {
  CoverSource,
  LookupResult,
  ProviderLyric,
  ResolvedCover,
  TrackQuery,
} from "./types";

function coverSourceFor(hit: ProviderLyric): CoverSource {
  if (hit.source === "apple-ttml") {
    return "itunes";
  }
  if (hit.source === "kugou") {
    return "kugou";
  }
  if (hit.source === "qqmusic" || hit.candidate.extra?.mid) {
    return "qqmusic";
  }
  if (
    hit.source === "netease" ||
    hit.source === "amll-ttml" ||
    hit.candidate.extra?.id
  ) {
    return "netease";
  }
  return "itunes";
}

async function resolveLyricOffsetMs(options: {
  audioPath: string;
  startSeconds: number;
  durationSeconds: number;
  lyric: ProviderLyric;
  query: TrackQuery;
}): Promise<number | undefined> {
  try {
    const lines = parseLyricText(options.lyric.content, options.lyric.format);
    const estimated = estimateLyricOffsetMs({
      lyricTimesMs: lyricOnsetTimesMs(lines),
      ...(await readRmsEnvelope({
        audioPath: options.audioPath,
        startSeconds: options.startSeconds,
        durationSeconds: options.durationSeconds,
      })),
    });
    if (!estimated) {
      return undefined;
    }
    console.log(
      `疑似歌词偏移 ${estimated.offsetMs}ms（《${options.query.title}》）`,
    );
    return estimated.offsetMs;
  } catch {
    return undefined;
  }
}

async function downloadCover(
  url: string,
  source: CoverSource,
  signal?: AbortSignal,
): Promise<ResolvedCover | undefined> {
  try {
    const { data, mimeType } = await fetchBytes(url, { signal });
    if (data.byteLength < 32) {
      return undefined;
    }
    return { source, data, mimeType };
  } catch {
    return undefined;
  }
}

export async function lookupTrack(options: {
  audioPath: string;
  title?: string;
  artist?: string;
  album?: string;
  durationInSeconds?: number;
  audioStartSeconds?: number;
  cover?: ResolvedCover;
  ignoreEmbeddedLyric?: boolean;
  lyricFormat?: LyricFormatPreference;
  signal?: AbortSignal;
}): Promise<LookupResult> {
  const tags = await readLocalTags(options.audioPath);
  const titleLocked = Boolean(options.title?.trim() || tags.title);
  const artistLocked = Boolean(options.artist?.trim() || tags.artist);
  const albumLocked = Boolean(options.album?.trim() || tags.album);
  const trackDuration =
    options.durationInSeconds && options.durationInSeconds > 0
      ? options.durationInSeconds
      : tags.durationInSeconds;

  const query: TrackQuery = {
    title: resolveQueryTitle(tags, options.audioPath, options.title),
    artist: firstNonBlank(options.artist, tags.artist),
    album: firstNonBlank(options.album, tags.album),
    durationMs: Math.round(trackDuration * 1000),
  };
  const keyword = buildSearchKeyword(query);
  const embeddedLyric = options.ignoreEmbeddedLyric
    ? undefined
    : tags.embeddedLyric;
  const needsLyric = shouldSearchLyrics(embeddedLyric);
  const coverFromFile =
    options.cover ??
    (tags.cover
      ? {
          source: "embedded" as const,
          data: tags.cover.data,
          mimeType: tags.cover.mimeType,
        }
      : undefined);
  const needsCover = !coverFromFile;
  const needsIdentity = !titleLocked || !artistLocked || !albumLocked;
  const signal = mergeSignals(
    options.signal,
    AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  );

  const [netease, qqmusic, kugou, lrclib, appleTtml, itunes, albumCoverHit] =
    await Promise.all([
      needsLyric ? lookupNetease(query, keyword, signal) : Promise.resolve(null),
      needsLyric ? lookupQqMusic(query, keyword, signal) : Promise.resolve(null),
      needsLyric ? lookupKugou(query, keyword, signal) : Promise.resolve(null),
      needsLyric ? lookupLrclib(query, keyword, signal) : Promise.resolve(null),
      needsLyric
        ? lookupAppleTtml(query, keyword, signal)
        : Promise.resolve(null),
      needsCover || needsIdentity
        ? lookupItunes(query, keyword, signal)
        : Promise.resolve(null),
      needsCover && query.album.trim()
        ? findAlbumCover(query, signal)
        : Promise.resolve(undefined),
    ]);

  const platformHits = [netease, qqmusic, kugou, lrclib, appleTtml].filter(
    (hit): hit is ProviderLyric => hit !== null,
  );
  const ttmlHits = (
    await Promise.all(
      platformHits
        .filter((hit) => hit.source === "netease" || hit.source === "qqmusic")
        .map((hit) => overlayAmlTtml(hit, signal)),
    )
  ).filter((hit): hit is ProviderLyric => hit !== null);

  const embeddedLyricHit: ProviderLyric | null = embeddedLyric
    ? {
        source: "embedded",
        format: embeddedLyric.format,
        content: embeddedLyric.content,
        candidate: {
          name: query.title,
          artist: query.artist,
          album: query.album,
          duration: query.durationMs,
        },
      }
    : null;

  const picked = pickBestLyric(
    [
      ...(embeddedLyricHit ? [embeddedLyricHit] : []),
      ...ttmlHits,
      ...platformHits,
    ],
    query,
    options.lyricFormat,
  );
  const lyric = picked
    ? { ...picked, content: sanitizeLyric(picked.content) }
    : undefined;
  if (
    options.lyricFormat &&
    (!lyric || !lyricMatchesPreference(lyric, options.lyricFormat))
  ) {
    console.log(
      lyric
        ? `没有 ${options.lyricFormat}，已改用 ${lyric.source} ${lyric.format}`
        : `没有 ${options.lyricFormat}`,
    );
  }

  const suspectedLyricOffsetMs = lyric
    ? await resolveLyricOffsetMs({
        audioPath: options.audioPath,
        startSeconds: options.audioStartSeconds ?? 0,
        durationSeconds: trackDuration,
        lyric,
        query,
      })
    : undefined;

  let cover: ResolvedCover | undefined = coverFromFile;
  if (!cover && albumCoverHit) {
    console.log(`封面匹配专辑 ${albumCoverHit.source}`);
    cover = await downloadCover(albumCoverHit.url, albumCoverHit.source, signal);
  }
  const lyricAlbumMatches =
    !query.album.trim() ||
    albumNamesMatch(lyric?.candidate.album, query.album);
  if (!cover && lyric?.coverUrl && lyricAlbumMatches) {
    cover = await downloadCover(lyric.coverUrl, coverSourceFor(lyric), signal);
  }
  const itunesAlbumMatches =
    !query.album.trim() ||
    albumNamesMatch(itunes?.candidate.album, query.album);
  if (!cover && itunes?.coverUrl && itunesAlbumMatches) {
    cover = await downloadCover(itunes.coverUrl, "itunes", signal);
  }
  if (!cover && query.album.trim()) {
    console.log(`没有和专辑匹配的封面（《${query.album}》）`);
  }

  const filenameTitle = titleFromAudioPath(options.audioPath);
  return {
    query,
    durationInSeconds: trackDuration,
    songName: prepareDisplayText(
      titleLocked
        ? query.title
        : firstNonBlank(
            lyric?.candidate.name,
            itunes?.candidate.name,
            query.title,
            filenameTitle,
          ),
    ),
    artistName:
      prepareDisplayText(
        artistLocked
          ? query.artist
          : firstNonBlank(
              lyric?.candidate.artist,
              itunes?.candidate.artist,
              query.artist,
            ),
      ) || "未知创作者",
    albumName:
      prepareDisplayText(
        albumLocked
          ? query.album
          : firstNonBlank(
              lyric?.candidate.album,
              itunes?.candidate.album,
              query.album,
            ),
      ) || "未知专辑",
    lyric: lyric
      ? {
          source: lyric.source,
          format: lyric.format,
          content: lyric.content,
          candidate: lyric.candidate,
        }
      : undefined,
    cover,
    suspectedLyricOffsetMs,
  };
}
