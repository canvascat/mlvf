import { scoreCandidate } from "../match";
import { fetchRaw, mergeSignals } from "../http";
import { validateLyric } from "../lyric-quality";
import type { ProviderLyric, TrackQuery } from "../types";
import {
  readAppleMusicAuth,
  type AppleMusicAuth,
} from "./apple-music-auth";

const AMP_ORIGIN = "https://music.apple.com";
const AMP_BASE = "https://amp-api.music.apple.com/v1";
const WEB_HOME = "https://music.apple.com/";
const BUNDLE_RE = /["'](\/assets\/index~[A-Za-z0-9]+\.js)["']/;
const JWT_RE =
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

const SEARCH_LIMIT = 10;
const SEARCH_TIMEOUT_MS = 4500;
const HOME_TIMEOUT_MS = 20_000;
const BUNDLE_TIMEOUT_MS = 45_000;
const SAME_RECORDING_MS = 2000;
const TRANSLATION_LANG = "zh-Hans-CN";
const SEARCH_REGIONS = ["cn", "tw", "jp"];
const ALIAS_ENTRIES = [
  { raw: "五月天", alias: "Mayday" },
  { raw: "茄子蛋", alias: "EggPlantEgg" },
  { raw: "告五人", alias: "Accusefive" },
];

const FEAT_PATTERN =
  /(?:[(（[【]\s*(?:feat|ft|featuring|with)\b[^)）\]】]*[)）\]】]|(?:\s+|^)(?:feat|ft|featuring|with)\b\.?\s*[^\s([{]+)/gi;

const INSTRUMENTAL_RE =
  /\b(instrumental|harmonic\s*accompaniment|karaoke|off\s*vocal)\b|[(（[【](?:伴奏|和声伴奏|纯音|纯乐)[)）\]】]/i;

const APPLE_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

const APPLE_HEADERS = {
  Accept: "application/json",
  Origin: AMP_ORIGIN,
  Referer: AMP_ORIGIN,
  "User-Agent": APPLE_UA,
};

type DevToken = {
  token: string;
  exp: number;
  iss?: string;
};

export type AppleSong = {
  id: string;
  name: string;
  singer: string;
  album: string;
  durationMs?: number;
  storefront: string;
  isrc: string;
  hasTimeSyncedLyrics: boolean;
  hasLyrics: boolean;
  inAccount: boolean;
  accountId?: string;
};

type AmpAttributes = {
  name?: string;
  artistName?: string;
  albumName?: string;
  durationInMillis?: number;
  isrc?: string;
  hasLyrics?: boolean;
  hasTimeSyncedLyrics?: boolean;
  ttml?: string;
  ttmlLocalizations?: string | Record<string, unknown>;
  displayType?: number | string;
};

type AmpSong = {
  id?: string | number;
  attributes?: AmpAttributes;
};

type AmpBody = {
  data?: AmpSong[];
  results?: { songs?: { data?: AmpSong[] } };
};

let devTokenCache: DevToken | null = null;
let devTokenTask: Promise<string> | null = null;
let devTokenFailed = false;
let tokenRejected = false;
let storefrontCache: string | null = null;

class AppleMusicTokenError extends Error {
  constructor() {
    super("Media-User-Token 无效或已过期");
  }
}

function appleSignal(parent: AbortSignal | undefined, ms: number): AbortSignal {
  return mergeSignals(parent, AbortSignal.timeout(ms));
}

function normalizeKey(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[、&;，,/|()（）[\]【】{}《》·・\s\-_'"`~!?？！.。…^]+/g, "");
}

function stripFeat(text: string): string {
  return text.replace(FEAT_PATTERN, "").trim();
}

function readJwtPayload(token: string): { exp?: number; iss?: string } | null {
  try {
    const part = token.split(".")[1];
    if (!part) {
      return null;
    }
    const padded = part.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as {
      exp?: number;
      iss?: string;
    };
  } catch {
    return null;
  }
}

function parseAmpBody(text: string): AmpBody | null {
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text) as AmpBody;
  } catch {
    return null;
  }
}

async function ampRequest(
  path: string,
  devToken: string,
  mediaUserToken: string | undefined,
  signal: AbortSignal,
): Promise<{ status: number; body: AmpBody | null }> {
  const headers: Record<string, string> = {
    ...APPLE_HEADERS,
    Authorization: `Bearer ${devToken}`,
  };
  if (mediaUserToken) {
    headers["Media-User-Token"] = mediaUserToken;
  }
  const send = () =>
    fetchRaw(`${AMP_BASE}${path}`, { signal, headers }).then((response) => ({
      status: response.status,
      body: parseAmpBody(response.text),
    }));
  try {
    return await send();
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "";
    if (!/network|reset|econnreset|timeout|fetch/i.test(message)) {
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    return send();
  }
}

async function fetchDevToken(signal: AbortSignal | undefined): Promise<DevToken> {
  const home = await fetchRaw(WEB_HOME, {
    signal: appleSignal(signal, HOME_TIMEOUT_MS),
    headers: { "User-Agent": APPLE_UA, Accept: "text/html" },
  });
  if (home.status !== 200) {
    throw new Error(`Apple Music 首页 HTTP ${home.status}`);
  }
  const bundlePath = BUNDLE_RE.exec(home.text)?.[1];
  if (!bundlePath) {
    throw new Error("未能在首页定位到 web player bundle");
  }
  const bundle = await fetchRaw(`${AMP_ORIGIN}${bundlePath}`, {
    signal: appleSignal(signal, BUNDLE_TIMEOUT_MS),
    headers: { "User-Agent": APPLE_UA, Accept: "*/*" },
  });
  if (bundle.status !== 200) {
    throw new Error(`web player bundle HTTP ${bundle.status}`);
  }
  const now = Math.floor(Date.now() / 1000);
  const seen = new Set<string>();
  const candidates: DevToken[] = [];
  for (const token of bundle.text.match(JWT_RE) ?? []) {
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    const payload = readJwtPayload(token);
    if (!payload?.exp || payload.exp <= now) {
      continue;
    }
    candidates.push({ token, exp: payload.exp, iss: payload.iss });
  }
  candidates.sort(
    (left, right) =>
      Number(right.iss === "AMPWebPlay") - Number(left.iss === "AMPWebPlay"),
  );
  for (const candidate of candidates) {
    const probe = await ampRequest(
      "/catalog/us/search?term=a&types=songs&limit=1",
      candidate.token,
      undefined,
      appleSignal(signal, SEARCH_TIMEOUT_MS),
    );
    if (probe.status === 200) {
      return candidate;
    }
  }
  throw new Error("bundle 中的开发者 token 均被拒绝");
}

async function getDevToken(
  signal: AbortSignal | undefined,
  force = false,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const valid = (entry: DevToken | null) =>
    Boolean(entry?.token) && (entry?.exp ?? 0) - 300 > now;
  if (!force && valid(devTokenCache)) {
    return devTokenCache!.token;
  }
  if (!devTokenTask) {
    devTokenTask = fetchDevToken(signal)
      .then((entry) => {
        devTokenCache = entry;
        devTokenFailed = false;
        return entry.token;
      })
      .finally(() => {
        devTokenTask = null;
      });
  }
  return devTokenTask;
}

async function ampRequestWithRetry(
  path: string,
  mediaUserToken: string,
  signal: AbortSignal | undefined,
  timeoutMs = SEARCH_TIMEOUT_MS,
): Promise<{ status: number; body: AmpBody | null }> {
  const send = async (token: string) =>
    ampRequest(path, token, mediaUserToken, appleSignal(signal, timeoutMs));
  let response = await send(await getDevToken(signal));
  if (response.status === 401) {
    response = await send(await getDevToken(signal, true));
  }
  if (response.status === 403) {
    throw new AppleMusicTokenError();
  }
  return response;
}

async function getAccountStorefront(
  auth: AppleMusicAuth,
  signal: AbortSignal | undefined,
): Promise<string> {
  if (auth.storefront) {
    return auth.storefront;
  }
  if (storefrontCache) {
    return storefrontCache;
  }
  const response = await ampRequestWithRetry(
    "/me/storefront",
    auth.mediaUserToken,
    signal,
  );
  const storefront = String(response.body?.data?.[0]?.id ?? "")
    .trim()
    .toLowerCase();
  if (!storefront) {
    throw new Error(`无法读取账号地区（HTTP ${response.status}）`);
  }
  storefrontCache = storefront;
  return storefrontCache;
}

function searchStorefronts(accountStorefront: string): string[] {
  return [
    accountStorefront,
    ...SEARCH_REGIONS.filter((region) => region !== accountStorefront),
  ];
}

export function expandSearchKeywords(keyword: string): string[] {
  const keywords = [keyword];
  const clean = stripFeat(keyword);
  if (clean && clean !== keyword) {
    keywords.push(clean);
  }
  const simplified = clean
    .replace(/^[()（）[\]【】\s….]+|[()（）[\]【】\s….]+$/g, "")
    .trim();
  if (simplified && !keywords.includes(simplified)) {
    keywords.push(simplified);
  }
  for (const current of [...keywords]) {
    for (const entry of ALIAS_ENTRIES) {
      if (current.toLowerCase().includes(entry.raw.toLowerCase())) {
        const expanded = current.replace(
          new RegExp(entry.raw, "gi"),
          entry.alias,
        );
        if (!keywords.includes(expanded)) {
          keywords.push(expanded);
        }
      } else if (current.toLowerCase().includes(entry.alias.toLowerCase())) {
        const expanded = current.replace(
          new RegExp(entry.alias, "gi"),
          entry.raw,
        );
        if (!keywords.includes(expanded)) {
          keywords.push(expanded);
        }
      }
    }
  }
  return keywords;
}

function sameRecording(leftMs?: number, rightMs?: number): boolean {
  return (
    Boolean(leftMs) &&
    Boolean(rightMs) &&
    Math.abs((leftMs ?? 0) - (rightMs ?? 0)) <= SAME_RECORDING_MS
  );
}

function isLive(song: Pick<AppleSong, "name" | "album">): boolean {
  return /\blive\b/i.test(song.name) || /\blive\b/i.test(song.album);
}

function isSingle(song: Pick<AppleSong, "name" | "album">): boolean {
  return /single|单曲|ep/i.test(song.album) || /single|单曲|ep/i.test(song.name);
}

function isInstrumental(song: Pick<AppleSong, "name" | "album">): boolean {
  return INSTRUMENTAL_RE.test(song.name) || INSTRUMENTAL_RE.test(song.album);
}

export function artistForMatch(keyword: string, song: AppleSong): string {
  let singer = song.singer;
  const flatKeyword = normalizeKey(stripFeat(keyword));
  const flatName = normalizeKey(stripFeat(song.name));
  if (flatName && flatKeyword.startsWith(flatName)) {
    const rest = flatKeyword.slice(flatName.length);
    if (rest.length >= 2 && !normalizeKey(singer).includes(rest)) {
      singer = `${singer}/${rest}`;
    }
  }
  for (const entry of ALIAS_ENTRIES) {
    const flatSinger = normalizeKey(singer);
    if (
      flatSinger.includes(normalizeKey(entry.raw)) &&
      !singer.split("/").includes(entry.alias)
    ) {
      singer = `${singer}/${entry.alias}`;
    } else if (
      flatSinger.includes(normalizeKey(entry.alias)) &&
      !singer.split("/").includes(entry.raw)
    ) {
      singer = `${singer}/${entry.raw}`;
    }
  }
  return singer;
}

function parseSong(item: AmpSong, storefront: string): AppleSong | null {
  const attributes = item.attributes;
  if (!attributes || item.id == null) {
    return null;
  }
  return {
    id: String(item.id),
    name: attributes.name ?? "",
    singer: attributes.artistName ?? "",
    album: attributes.albumName ?? "",
    durationMs: attributes.durationInMillis,
    storefront,
    isrc: attributes.isrc ?? "",
    hasTimeSyncedLyrics: Boolean(attributes.hasTimeSyncedLyrics),
    hasLyrics: Boolean(attributes.hasLyrics),
    inAccount: false,
  };
}

function toSearchSong(item: AmpSong, storefront: string): AppleSong | null {
  const song = parseSong(item, storefront);
  if (!song?.hasLyrics || isInstrumental(song)) {
    return null;
  }
  return song;
}

export function mergeAppleSongs(
  songs: readonly AppleSong[],
  accountStorefront: string,
  keyword: string,
): AppleSong[] {
  const accountSongs = songs.filter(
    (song) => song.storefront === accountStorefront,
  );
  const flatKeyword = normalizeKey(stripFeat(keyword));
  const merged = new Map<string, AppleSong>();
  for (const song of songs) {
    const kept = merged.get(song.id);
    if (!kept) {
      merged.set(song.id, {
        ...song,
        inAccount: song.storefront === accountStorefront,
      });
      continue;
    }
    kept.inAccount =
      kept.inAccount || song.storefront === accountStorefront;
    const keptMatches = flatKeyword.startsWith(normalizeKey(stripFeat(kept.name)));
    if (
      !keptMatches &&
      flatKeyword.startsWith(normalizeKey(stripFeat(song.name)))
    ) {
      kept.name = song.name;
      kept.singer = song.singer;
      kept.album = song.album;
    }
  }

  for (const song of merged.values()) {
    if (song.inAccount) {
      continue;
    }
    const twin =
      (song.isrc
        ? accountSongs.find((item) => item.isrc && item.isrc === song.isrc)
        : undefined) ??
      accountSongs.find((item) =>
        sameRecording(item.durationMs, song.durationMs),
      );
    if (twin) {
      song.accountId = twin.id;
    }
  }
  return [...merged.values()];
}

export function orderAppleSongs(
  songs: readonly AppleSong[],
  query: TrackQuery,
  keyword: string,
): AppleSong[] {
  const keywordLive = /\blive\b/i.test(keyword);
  const ranked = songs
    .map((song) => {
      const candidate = {
        name: song.name,
        artist: artistForMatch(keyword, song),
        album: song.album,
        duration: song.durationMs,
      };
      return { song, score: scoreCandidate(candidate, query) };
    })
    .filter((item) => item.score >= 0);
  ranked.sort((left, right) => {
    if (!keywordLive && isLive(left.song) !== isLive(right.song)) {
      return isLive(left.song) ? 1 : -1;
    }
    if (left.song.hasTimeSyncedLyrics !== right.song.hasTimeSyncedLyrics) {
      return left.song.hasTimeSyncedLyrics ? -1 : 1;
    }
    if (isSingle(left.song) !== isSingle(right.song)) {
      return isSingle(left.song) ? -1 : 1;
    }
    return right.score - left.score;
  });
  return ranked.map((item) => item.song);
}

export function preferSingleTwins(songs: readonly AppleSong[]): AppleSong[] {
  return [...songs].sort((left, right) => {
    if (isSingle(left) === isSingle(right)) {
      return 0;
    }
    return isSingle(left) ? -1 : 1;
  });
}

export function isSyllableTtml(ttml: string): boolean {
  return /<span\b[^>]*\b(begin|end)\s*=/i.test(ttml);
}

export function pickTtml(body: AmpBody | null): string {
  const attributes = body?.data?.[0]?.attributes;
  if (!attributes) {
    return "";
  }
  const localized = attributes.ttmlLocalizations;
  if (typeof localized === "string" && localized.trim()) {
    return localized;
  }
  return attributes.ttml ?? "";
}

export function applyReplacementTranslations(ttml: string): string {
  const replacement =
    /<translation\b[^>]*\btype=["']replacement["'][^>]*>([\s\S]*?)<\/translation>/i.exec(
      ttml,
    );
  if (!replacement) {
    return ttml;
  }
  const transLang = /\bxml:lang=["']([^"']+)["']/i.exec(replacement[0]);
  const targetLang = transLang?.[1] ?? "zh-Hans";
  const textRegex = /<text\b[^>]*\bfor=["']([^"']+)["'][^>]*>([\s\S]*?)<\/text>/gi;
  const replacementMap = new Map<string, string>();
  let textMatch: RegExpExecArray | null;
  while ((textMatch = textRegex.exec(replacement[1])) !== null) {
    replacementMap.set(
      textMatch[1],
      textMatch[2].replace(/\s+xmlns(?::\w+)?=["'][^"']+["']/g, ""),
    );
  }
  if (replacementMap.size === 0) {
    return ttml;
  }
  let processed = ttml.replace(
    /(<p\b([^>]*\bitunes:key=["']([^"']+)["'][^>]*)>)([\s\S]*?)(<\/p>)/gi,
    (full, openTag: string, _attrs: string, key: string, _content: string, closeTag: string) => {
      const next = replacementMap.get(key);
      if (next === undefined) {
        return full;
      }
      return `${openTag}${next}${closeTag}`;
    },
  );
  processed = processed.replace(
    /<translation\b[^>]*\btype=["']replacement["'][^>]*>[\s\S]*?<\/translation>/i,
    "",
  );
  processed = processed.replace(/<translations>\s*<\/translations>/gi, "");
  processed = processed.replace(
    /(<tt\b[^>]*\bxml:lang=["'])[^"']+([^>]*>)/i,
    `$1${targetLang}$2`,
  );
  return processed;
}

function isLineTtml(ttml: string, displayType: unknown): boolean {
  return (
    displayType === 2 ||
    displayType === "2" ||
    !isSyllableTtml(ttml)
  );
}

function lyricQuery(): string {
  const script = TRANSLATION_LANG.split("-").slice(0, 2).join("-");
  return `?extend=ttmlLocalizations&l%5Blyrics%5D=${encodeURIComponent(TRANSLATION_LANG)}&l%5Bscript%5D=${encodeURIComponent(script)}`;
}

async function searchStorefront(
  storefront: string,
  keyword: string,
  mediaUserToken: string,
  signal: AbortSignal | undefined,
): Promise<AppleSong[]> {
  const path = `/catalog/${storefront}/search?term=${encodeURIComponent(keyword)}&types=songs&limit=${SEARCH_LIMIT}`;
  const response = await ampRequestWithRetry(
    path,
    mediaUserToken,
    signal,
  );
  if (response.status !== 200) {
    return [];
  }
  return (response.body?.results?.songs?.data ?? [])
    .map((item) => toSearchSong(item, storefront))
    .filter((song): song is AppleSong => song !== null);
}

async function resolveAccountSongId(
  song: AppleSong,
  accountStorefront: string,
  mediaUserToken: string,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  if (song.inAccount || song.storefront === accountStorefront) {
    return song.id;
  }
  if (song.accountId) {
    return song.accountId;
  }
  if (song.isrc) {
    const response = await ampRequestWithRetry(
      `/catalog/${accountStorefront}/songs?filter%5Bisrc%5D=${encodeURIComponent(song.isrc)}`,
      mediaUserToken,
      signal,
    );
    const matches = (response.body?.data ?? [])
      .map((item) => parseSong(item, accountStorefront))
      .filter((item): item is AppleSong => item !== null)
      .filter(
        (item) =>
          !song.durationMs || sameRecording(item.durationMs, song.durationMs),
      );
    const best =
      matches.find((item) => item.hasTimeSyncedLyrics) ??
      matches.find((item) => item.hasLyrics);
    if (best) {
      return best.id;
    }
  }
  const direct = await ampRequestWithRetry(
    `/catalog/${accountStorefront}/songs/${song.id}`,
    mediaUserToken,
    signal,
  );
  if (direct.status === 200) {
    return song.id;
  }
  return null;
}

async function readSyllable(
  storefront: string,
  songId: string,
  mediaUserToken: string,
  signal: AbortSignal | undefined,
): Promise<{ ttml: string; line: boolean; isrc: string } | null> {
  const response = await ampRequestWithRetry(
    `/catalog/${storefront}/songs/${songId}/syllable-lyrics${lyricQuery()}`,
    mediaUserToken,
    signal,
  );
  if (response.status !== 200) {
    return null;
  }
  const attributes = response.body?.data?.[0]?.attributes;
  const raw = pickTtml(response.body);
  if (!attributes || !raw.trim()) {
    return null;
  }
  const ttml = applyReplacementTranslations(raw);
  return {
    ttml,
    line: isLineTtml(ttml, attributes.displayType),
    isrc: attributes.isrc ?? "",
  };
}

async function upgradeFromTwin(
  storefront: string,
  songId: string,
  isrc: string,
  mediaUserToken: string,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  const response = await ampRequestWithRetry(
    `/catalog/${storefront}/songs?filter%5Bisrc%5D=${encodeURIComponent(isrc)}`,
    mediaUserToken,
    signal,
  );
  const twins = (response.body?.data ?? [])
    .map((item) => parseSong(item, storefront))
    .filter((item): item is AppleSong => item !== null)
    .filter((item) => item.id !== songId && !isInstrumental(item));
  for (const twin of preferSingleTwins(twins).slice(0, 4)) {
    const syllable = await readSyllable(
      storefront,
      twin.id,
      mediaUserToken,
      signal,
    );
    if (syllable && !syllable.line && isSyllableTtml(syllable.ttml)) {
      return syllable.ttml;
    }
  }
  return null;
}

export async function lookupAppleTtml(
  query: TrackQuery,
  keyword: string,
  parentSignal?: AbortSignal,
): Promise<ProviderLyric | null> {
  if (tokenRejected || devTokenFailed) {
    return null;
  }
  const auth = readAppleMusicAuth();
  if (!auth) {
    return null;
  }
  try {
    const storefront = await getAccountStorefront(auth, parentSignal);
    const keywords = expandSearchKeywords(keyword);
    const groups = await Promise.all(
      keywords.flatMap((term) =>
        searchStorefronts(storefront).map((region) =>
          searchStorefront(region, term, auth.mediaUserToken, parentSignal).catch(
            (error: unknown) => {
              if (error instanceof AppleMusicTokenError) {
                throw error;
              }
              return [] as AppleSong[];
            },
          ),
        ),
      ),
    );
    const best = orderAppleSongs(
      mergeAppleSongs(groups.flat(), storefront, keyword),
      query,
      keyword,
    )[0];
    if (!best) {
      return null;
    }
    const songId = await resolveAccountSongId(
      best,
      storefront,
      auth.mediaUserToken,
      parentSignal,
    );
    if (!songId) {
      return null;
    }
    const syllable = await readSyllable(
      storefront,
      songId,
      auth.mediaUserToken,
      parentSignal,
    );
    if (!syllable) {
      return null;
    }
    let content = syllable.ttml;
    if (syllable.line) {
      const isrc = best.isrc || syllable.isrc;
      const upgraded = isrc
        ? await upgradeFromTwin(
            storefront,
            songId,
            isrc,
            auth.mediaUserToken,
            parentSignal,
          )
        : null;
      if (!upgraded) {
        return null;
      }
      content = upgraded;
    }
    if (!isSyllableTtml(content) || !validateLyric(content, "ttml")) {
      return null;
    }
    return {
      source: "apple-ttml",
      format: "ttml",
      content,
      candidate: {
        name: best.name,
        artist: artistForMatch(keyword, best),
        album: best.album,
        duration: best.durationMs,
        extra: { appleId: songId },
      },
    };
  } catch (error) {
    if (error instanceof AppleMusicTokenError) {
      tokenRejected = true;
      console.log("Apple Music TTML：Media-User-Token 无效或已过期");
      return null;
    }
    if (!devTokenCache) {
      devTokenFailed = true;
      const message = error instanceof Error ? error.message : "";
      console.log(
        `Apple Music TTML：开发者 token 获取失败${message ? `（${message}）` : ""}`,
      );
    }
    return null;
  }
}
