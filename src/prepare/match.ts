import { lyricSelectionRank } from "./lyric-quality";
import type { LyricCandidate, ProviderLyric, TrackQuery } from "./types";

const LYRIC_FORMAT_PREFERENCES = ["krc", "ttml", "yrc", "qrc", "lys", "lrc"] as const;

export type LyricFormatPreference = (typeof LYRIC_FORMAT_PREFERENCES)[number];

export function parseLyricFormatPreference(value: string): LyricFormatPreference {
  const normalized = value.trim().toLowerCase();
  if ((LYRIC_FORMAT_PREFERENCES as readonly string[]).includes(normalized)) {
    return normalized as LyricFormatPreference;
  }
  throw new Error(`不支持的歌词格式: ${value}`);
}

export function lyricMatchesPreference(
  hit: ProviderLyric,
  preference: LyricFormatPreference,
): boolean {
  if (preference === "krc") {
    return hit.source === "kugou" && hit.format === "yrc";
  }
  return hit.format === preference;
}

const NAME_CONTAIN_MIN_RATIO = 0.34;
const DURATION_CLOSE_MS = 5000;
const DURATION_FAR_MS = 20000;

export function normalize(text: string | undefined | null): string {
  if (!text) {
    return "";
  }
  return text.toLowerCase().replace(/[、&;，,/|()·・\s\-_'"`~!?？！.。]+/g, "");
}

/** 去掉括号里的译名、版本和合作者，再拿来对歌名。 */
function nameCore(text: string | undefined | null): string {
  let value = text ?? "";
  for (let i = 0; i < 4; i += 1) {
    const next = value.replace(/\s*[(（][^()（）]*[)）]\s*/g, " ");
    if (next === value) {
      break;
    }
    value = next;
  }
  return normalize(value);
}

/** 本地专辑名和在线专辑名是否同一张。波浪号和空格不算差别。 */
export function albumNamesMatch(
  left: string | undefined | null,
  right: string | undefined | null,
): boolean {
  const album = (value: string | undefined | null) =>
    normalize(value).replace(/[～〜]/g, "");
  const a = album(left);
  const b = album(right);
  return Boolean(a) && a === b;
}

export function buildSearchKeyword(query: TrackQuery): string {
  return [query.title, query.artist]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

function bothContains(left: string, right: string): boolean {
  return (
    left.length > 0 &&
    right.length > 0 &&
    (left.includes(right) || right.includes(left))
  );
}

function splitArtists(text: string | undefined | null): string[] {
  return (text ?? "")
    .split(/[、&;，,/|·・]+/g)
    .map(normalize)
    .filter(Boolean);
}

function queryArtists(query: TrackQuery): string[] {
  return splitArtists(query.artist);
}

function artistMatches(
  candidateArtist: string | undefined | null,
  trackArtists: readonly string[],
): { exact: boolean; contains: boolean } {
  if (trackArtists.length === 0) {
    return { exact: false, contains: false };
  }
  const candFull = normalize(candidateArtist);
  const candParts = splitArtists(candidateArtist);
  if (!candFull) {
    return { exact: false, contains: false };
  }
  const exact = trackArtists.some(
    (artist) => candFull === artist || candParts.some((part) => part === artist),
  );
  if (exact) {
    return { exact: true, contains: false };
  }
  const contains = trackArtists.some(
    (artist) =>
      artist.length >= 2 &&
      (bothContains(candFull, artist) ||
        candParts.some((part) => bothContains(part, artist))),
  );
  return { exact: false, contains };
}

function durationClose(
  leftMs?: number,
  rightMs?: number,
  tolMs = DURATION_CLOSE_MS,
): boolean {
  if (!leftMs || !rightMs) {
    return false;
  }
  return Math.abs(leftMs - rightMs) <= tolMs;
}

function durationFar(
  leftMs?: number,
  rightMs?: number,
  tolMs = DURATION_FAR_MS,
): boolean {
  if (!leftMs || !rightMs) {
    return false;
  }
  return Math.abs(leftMs - rightMs) > tolMs;
}

/**
 * 硬性条件不满足返回 -1；否则分数越高越优先。
 */
export function scoreCandidate(
  candidate: LyricCandidate,
  query: TrackQuery,
): number {
  const trackName = normalize(query.title);
  const trackArtists = queryArtists(query);
  const trackAlbum = normalize(query.album);
  const trackDuration = query.durationMs;
  const candName = normalize(candidate.name);
  const candAlbum = normalize(candidate.album);

  const trackCore = nameCore(query.title);
  const candCore = nameCore(candidate.name);
  const nameExact =
    (candName.length > 0 && candName === trackName) ||
    (candCore.length > 0 && candCore === trackCore);
  if (!nameExact) {
    if (!bothContains(candName, trackName)) {
      return -1;
    }
    const longer = Math.max(candName.length, trackName.length);
    const shorter = Math.min(candName.length, trackName.length);
    if (shorter / longer < NAME_CONTAIN_MIN_RATIO) {
      return -1;
    }
  }

  if (durationFar(candidate.duration, trackDuration)) {
    return -1;
  }

  const artist = artistMatches(candidate.artist, trackArtists);
  if (trackArtists.length > 0 && !artist.exact && !artist.contains) {
    return -1;
  }
  if (
    !nameExact &&
    !artist.exact &&
    !artist.contains &&
    !durationClose(candidate.duration, trackDuration)
  ) {
    return -1;
  }

  let score = nameExact ? 10 : 4;
  if (artist.exact) {
    score += 5;
  } else if (artist.contains) {
    score += 2;
  }
  if (trackAlbum && candAlbum === trackAlbum) {
    score += 2;
  }
  if (durationClose(candidate.duration, trackDuration)) {
    score += 3;
  }
  return score;
}

export function pickBestCandidate(
  candidates: readonly LyricCandidate[],
  query: TrackQuery,
): LyricCandidate | null {
  let best: LyricCandidate | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, query);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

export function durationDeltaMs(
  candidate: LyricCandidate,
  query: TrackQuery,
): number | undefined {
  if (!candidate.duration || !query.durationMs) {
    return undefined;
  }
  return Math.abs(candidate.duration - query.durationMs);
}

export function needsLyricAlign(
  candidate: LyricCandidate | undefined,
  query: TrackQuery,
): boolean {
  const delta = candidate ? durationDeltaMs(candidate, query) : undefined;
  return delta === undefined || delta > DURATION_CLOSE_MS;
}

const DURATION_SIMILAR_MS = 2000;

export function shouldSearchLyrics(
  embedded?: { format: ProviderLyric["format"] },
): boolean {
  return embedded?.format !== "ttml";
}

function selectLyric(
  hits: readonly ProviderLyric[],
  query: TrackQuery,
): ProviderLyric | null {
  let best: ProviderLyric | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  let bestRank = -1;
  let bestScore = -1;

  for (const hit of hits) {
    const score = scoreCandidate(hit.candidate, query);
    if (score < 0) {
      continue;
    }
    const delta =
      durationDeltaMs(hit.candidate, query) ?? Number.POSITIVE_INFINITY;
    const rank = lyricSelectionRank(hit);
    const closer = delta < bestDelta - DURATION_SIMILAR_MS;
    const farther = delta > bestDelta + DURATION_SIMILAR_MS;
    const sameFormat = rank === bestRank;
    if (
      !best ||
      rank > bestRank ||
      (sameFormat && (closer || (!farther && score > bestScore)))
    ) {
      best = hit;
      bestDelta = delta;
      bestRank = rank;
      bestScore = score;
    }
  }
  return best;
}

export function pickBestLyric(
  hits: readonly ProviderLyric[],
  query: TrackQuery,
  preference?: LyricFormatPreference,
): ProviderLyric | null {
  if (!preference) {
    return selectLyric(hits, query);
  }
  const preferred = hits.filter((hit) =>
    lyricMatchesPreference(hit, preference),
  );
  return selectLyric(preferred, query) ?? selectLyric(hits, query);
}
