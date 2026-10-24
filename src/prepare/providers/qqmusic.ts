import { decryptQrcHex } from "@applemusic-like-lyrics/lyric";
import { durationDeltaMs, pickBestCandidate, scoreCandidate } from "../match";
import {
  decodeHtmlEntities,
  fetchJson,
  providerSignal,
} from "../http";
import { mergeLrcTranslation, validateLyric } from "../lyric-quality";
import type { LyricCandidate, ProviderLyric, TrackQuery } from "../types";

type SearchSong = {
  mid?: string;
  id?: number;
  title?: string;
  interval?: number;
  singer?: Array<{ name?: string }>;
  album?: { name?: string; title?: string; mid?: string; pmid?: string };
};

type SearchResponse = {
  code?: number;
  data?: {
    song?: { list?: SearchSong[] };
  };
};

type MusicuSearchResponse = {
  req?: {
    data?: {
      body?: {
        song?: { list?: SearchSong[] };
      };
    };
  };
};

type LyricResponse = {
  lyric?: string;
  trans?: string;
};

type PlayLyricData = {
  lyric?: string;
  trans?: string;
  roma?: string;
  qrc_t?: number;
};

type PlayLyricResponse = {
  request?: {
    code?: number;
    data?: PlayLyricData;
  };
};

const QQ_LYRIC_COMM = {
  ct: 11,
  cv: 14090008,
  v: 14090008,
  chid: "10003505",
  os_ver: "15",
  phonetype: "24122RKC7C",
  tmeAppID: "qqmusic",
  nettype: "NETWORK_WIFI",
  udid: "0",
  OpenUDID: "0",
  QIMEI36: "0",
  uin: "0",
};

const QQ_LYRIC_HEADERS = {
  Referer: "https://y.qq.com",
  "Content-Type": "application/json",
  "User-Agent": "QQMusic 14090008(android 15)",
  Cookie: "tmeLoginType=-1;",
};

const TRANSLATION_MARK = "[rmv-translation]";
const ROMAN_MARK = "[rmv-roman]";
const QRC_CANDIDATE_LIMIT = 4;

export function qrcTextFromEncrypted(hex: string): string {
  const cipher = hex.trim();
  if (!/^[0-9a-fA-F]+$/.test(cipher) || cipher.length < 32 || cipher.length % 2 !== 0) {
    return "";
  }
  let text = "";
  try {
    text = decryptQrcHex(cipher);
  } catch {
    return "";
  }
  const marker = 'LyricContent="';
  const start = text.indexOf(marker);
  if (start < 0) {
    return text.trim();
  }
  const from = start + marker.length;
  const end = text.lastIndexOf('"');
  if (end <= from) {
    return "";
  }
  return text.slice(from, end).trim();
}

function utf8Base64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

function withQrcAnnotations(
  main: string,
  translation: string,
  roman: string,
): string {
  let content = main.trim();
  if (translation && validateLyric(translation, "lrc")) {
    content += `\n${TRANSLATION_MARK}\n${translation.trim()}\n`;
  }
  if (roman && validateLyric(roman, "qrc")) {
    content += `\n${ROMAN_MARK}\n${roman.trim()}\n`;
  }
  return content;
}

function rankedCandidates(
  candidates: readonly LyricCandidate[],
  query: TrackQuery,
): LyricCandidate[] {
  return candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(candidate, query),
      delta: durationDeltaMs(candidate, query) ?? Number.POSITIVE_INFINITY,
    }))
    .filter((item) => item.score > 0 && item.candidate.extra?.id)
    .sort((left, right) => right.score - left.score || left.delta - right.delta)
    .slice(0, QRC_CANDIDATE_LIMIT)
    .map((item) => item.candidate);
}

const QQ_HEADERS = {
  Referer: "https://y.qq.com/",
};

function singerNames(song: SearchSong): string {
  return (song.singer ?? [])
    .map((singer) => singer.name?.trim())
    .filter(Boolean)
    .join("/");
}

function albumMid(song: SearchSong): string {
  return song.album?.mid || song.album?.pmid || "";
}

function coverUrl(mid: string): string | undefined {
  if (!mid) {
    return undefined;
  }
  return `https://y.gtimg.cn/music/photo_new/T002R800x800M000${mid}.jpg`;
}

function toCandidate(song: SearchSong): LyricCandidate | null {
  if (!song.mid || !song.title) {
    return null;
  }
  return {
    name: song.title,
    artist: singerNames(song),
    album: song.album?.name || song.album?.title,
    duration: (song.interval ?? 0) * 1000 || undefined,
    extra: {
      mid: song.mid,
      id: song.id ? String(song.id) : "",
      albumMid: albumMid(song),
    },
  };
}

async function searchSongs(
  keyword: string,
  signal: AbortSignal,
): Promise<SearchSong[]> {
  const musicu = await fetchJson<MusicuSearchResponse>(
    "https://u.y.qq.com/cgi-bin/musicu.fcg",
    {
      signal,
      headers: { ...QQ_HEADERS, "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({
        comm: { ct: "19", cv: "1859", uin: "0" },
        req: {
          method: "DoSearchForQQMusicDesktop",
          module: "music.search.SearchCgiService",
          param: {
            query: keyword,
            num_per_page: 20,
            page_num: 1,
            search_type: 0,
          },
        },
      }),
    },
  );
  const fromMusicu = musicu.req?.data?.body?.song?.list ?? [];
  if (fromMusicu.length > 0) {
    return fromMusicu;
  }

  const params = new URLSearchParams({
    format: "json",
    new_json: "1",
    t: "0",
    aggr: "1",
    cr: "1",
    p: "1",
    n: "20",
    w: keyword,
  });
  const body = await fetchJson<SearchResponse>(
    `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?${params.toString()}`,
    { signal, headers: QQ_HEADERS },
  );
  return body.data?.song?.list ?? [];
}

export async function lookupQqMusic(
  query: TrackQuery,
  keyword: string,
  parentSignal?: AbortSignal,
): Promise<ProviderLyric | null> {
  const signal = providerSignal(parentSignal);
  try {
    const songs = await searchSongs(keyword, signal);
    const candidates = songs
      .map(toCandidate)
      .filter((item): item is LyricCandidate => item !== null);
    const best = pickBestCandidate(candidates, query);
    const mid = best?.extra?.mid;
    if (!best || !mid) {
      return null;
    }

    for (const candidate of rankedCandidates(candidates, query)) {
      const songId = Number(candidate.extra?.id || 0);
      if (!Number.isFinite(songId) || songId <= 0) {
        continue;
      }
      const play = await fetchJson<PlayLyricResponse>(
        "https://u.y.qq.com/cgi-bin/musicu.fcg",
        {
          signal,
          headers: QQ_LYRIC_HEADERS,
          method: "POST",
          body: JSON.stringify({
            comm: QQ_LYRIC_COMM,
            request: {
              module: "music.musichallSong.PlayLyricInfo",
              method: "GetPlayLyricInfo",
              param: {
                albumName: utf8Base64(candidate.album ?? ""),
                crypt: 1,
                ct: 19,
                cv: 2111,
                interval: Math.round((candidate.duration ?? 0) / 1000),
                lrc_t: 0,
                qrc: 1,
                qrc_t: 0,
                roma: 1,
                roma_t: 0,
                singerName: utf8Base64(candidate.artist),
                songID: songId,
                songName: utf8Base64(candidate.name),
                trans: 1,
                trans_t: 0,
                type: 0,
              },
            },
          }),
        },
      );
      const data = play.request?.data;
      if (!data || data.qrc_t === 0) {
        continue;
      }
      const qrc = qrcTextFromEncrypted(data.lyric ?? "");
      if (!qrc || !validateLyric(qrc, "qrc")) {
        continue;
      }
      return {
        source: "qqmusic",
        format: "qrc",
        content: withQrcAnnotations(
          qrc,
          qrcTextFromEncrypted(data.trans ?? ""),
          qrcTextFromEncrypted(data.roma ?? ""),
        ),
        candidate,
        coverUrl: coverUrl(candidate.extra?.albumMid || ""),
      };
    }

    const lyricParams = new URLSearchParams({
      format: "json",
      nobase64: "1",
      g_tk: "5381",
      songmid: mid,
    });
    const lyric = await fetchJson<LyricResponse>(
      `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${lyricParams.toString()}`,
      { signal, headers: QQ_HEADERS },
    );
    const lrc = decodeHtmlEntities(lyric.lyric?.trim() || "");
    const translation = decodeHtmlEntities(lyric.trans?.trim() || "");
    if (!lrc) {
      return null;
    }
    const merged = mergeLrcTranslation(lrc, translation || undefined);
    if (!validateLyric(merged, "lrc")) {
      return null;
    }
    return {
      source: "qqmusic",
      format: "lrc",
      content: merged,
      candidate: best,
      coverUrl: coverUrl(best.extra?.albumMid || ""),
    };
  } catch {
    return null;
  }
}
