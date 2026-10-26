import { albumNamesMatch, pickBestCandidate } from "../match";
import {
  fetchJson,
  providerSignal,
  stripNeteaseEscapes,
} from "../http";
import { mergeLrcTranslation, validateLyric } from "../lyric-quality";
import type { LyricCandidate, ProviderLyric, TrackQuery } from "../types";

type SearchSong = {
  id: number;
  name: string;
  artists?: Array<{ name: string }>;
  album?: { name: string };
  duration?: number;
};

type SearchResponse = {
  code?: number;
  result?: { songs?: SearchSong[] };
};

type LyricBundle = {
  lrc?: { lyric?: string };
  tlyric?: { lyric?: string };
  yrc?: { lyric?: string };
  ytlrc?: { lyric?: string };
  pureMusic?: boolean;
};

type SongDetail = {
  songs?: Array<{ album?: { picUrl?: string } }>;
};

const SEARCH_PRIMARY =
  "https://music.163.com/api/search/get";
const SEARCH_FALLBACK =
  "https://music.163.com/api/search/get/web";

const NETEASE_HEADERS = {
  Referer: "https://music.163.com/",
};

function searchUrl(base: string, keyword: string): string {
  const params = new URLSearchParams({
    s: keyword,
    type: "1",
    offset: "0",
    limit: "20",
  });
  return `${base}?${params.toString()}`;
}

async function searchSongs(
  keyword: string,
  signal?: AbortSignal,
): Promise<SearchSong[]> {
  const tryEndpoint = async (base: string): Promise<SearchSong[] | null> => {
    const body = await fetchJson<SearchResponse>(searchUrl(base, keyword), {
      signal,
      headers: NETEASE_HEADERS,
    });
    if (body.code === 405 || body.code === 406) {
      return null;
    }
    return body.result?.songs ?? [];
  };

  try {
    const songs = await tryEndpoint(SEARCH_PRIMARY);
    if (songs) {
      return songs;
    }
  } catch {
    // 走兜底端点
  }
  return (await tryEndpoint(SEARCH_FALLBACK)) ?? [];
}

function toCandidate(song: SearchSong): LyricCandidate {
  return {
    name: song.name,
    artist: (song.artists ?? []).map((artist) => artist.name).join(" / "),
    album: song.album?.name,
    duration: song.duration,
    extra: { id: String(song.id) },
  };
}

type AlbumSearch = {
  code?: number;
  result?: {
    albums?: Array<{ name?: string; picUrl?: string }>;
  };
};

export async function findNeteaseAlbumCover(
  query: TrackQuery,
  signal: AbortSignal,
): Promise<string | undefined> {
  if (!query.album.trim()) {
    return undefined;
  }
  try {
    const params = new URLSearchParams({
      s: `${query.album} ${query.artist}`.trim(),
      type: "10",
      offset: "0",
      limit: "10",
    });
    const body = await fetchJson<AlbumSearch>(
      `${SEARCH_PRIMARY}?${params.toString()}`,
      { signal, headers: NETEASE_HEADERS },
    );
    if (body.code === 405 || body.code === 406) {
      return undefined;
    }
    for (const album of body.result?.albums ?? []) {
      if (!album.picUrl || !albumNamesMatch(album.name, query.album)) {
        continue;
      }
      return album.picUrl.includes("?")
        ? album.picUrl
        : `${album.picUrl}?param=800y800`;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function lookupNetease(
  query: TrackQuery,
  keyword: string,
  parentSignal?: AbortSignal,
): Promise<ProviderLyric | null> {
  const signal = providerSignal(parentSignal);
  try {
    const songs = await searchSongs(keyword, signal);
    const candidates = songs.map(toCandidate);
    const best = pickBestCandidate(candidates, query);
    const id = best?.extra?.id;
    if (!best || !id) {
      return null;
    }

    const [bundle, yrcBody, detail] = await Promise.all([
      fetchJson<LyricBundle>(
        `https://music.163.com/api/song/lyric?id=${id}&lv=-1&kv=-1&tv=-1&rv=-1`,
        { signal, headers: NETEASE_HEADERS },
      ).catch(() => null),
      fetchJson<LyricBundle>(
        `https://music.163.com/api/song/lyric/v1?id=${id}&yv=-1`,
        { signal, headers: NETEASE_HEADERS },
      ).catch(() => null),
      fetchJson<SongDetail>(
        `https://music.163.com/api/song/detail?ids=[${id}]`,
        { signal, headers: NETEASE_HEADERS },
      ).catch(() => null),
    ]);

    if (bundle?.pureMusic) {
      return null;
    }

    const yrc = stripNeteaseEscapes(yrcBody?.yrc?.lyric?.trim() || "");
    const lrc = stripNeteaseEscapes(bundle?.lrc?.lyric?.trim() || "");
    const translation = stripNeteaseEscapes(
      yrcBody?.ytlrc?.lyric?.trim() || bundle?.tlyric?.lyric?.trim() || "",
    );
    const coverUrl = detail?.songs?.[0]?.album?.picUrl
      ? `${detail.songs[0].album.picUrl}?param=800y800`
      : undefined;

    if (yrc && validateLyric(yrc, "yrc")) {
      return {
        source: "netease",
        format: "yrc",
        content: yrc,
        candidate: best,
        coverUrl,
      };
    }
    if (!lrc) {
      return null;
    }
    const merged = mergeLrcTranslation(lrc, translation || undefined);
    if (!validateLyric(merged, "lrc")) {
      return null;
    }
    return {
      source: "netease",
      format: "lrc",
      content: merged,
      candidate: best,
      coverUrl,
    };
  } catch {
    return null;
  }
}
