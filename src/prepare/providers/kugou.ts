import { decryptKrc, krcToYrc, prefersKugouKrc } from "../krc";
import { albumNamesMatch, pickBestCandidate } from "../match";
import { fetchJson, providerSignal } from "../http";
import { validateLyric } from "../lyric-quality";
import type { LyricCandidate, ProviderLyric, TrackQuery } from "../types";

type SearchSong = {
  hash?: string;
  songname?: string;
  singername?: string;
  album_name?: string;
  album_id?: string;
  duration?: number;
};

type SearchResponse = {
  data?: { info?: SearchSong[] };
};

type KugouLyricHit = {
  id?: string;
  accesskey?: string;
  krctype?: number;
  contenttype?: number;
};

type LyricSearch = {
  candidates?: KugouLyricHit[];
};

type LyricDownload = {
  content?: string;
};

type AlbumInfo = {
  data?: { imgurl?: string };
};

function toCandidate(song: SearchSong): LyricCandidate | null {
  if (!song.hash || !song.songname) {
    return null;
  }
  return {
    name: song.songname,
    artist: song.singername ?? "",
    album: song.album_name,
    duration: song.duration ? song.duration * 1000 : undefined,
    extra: { hash: song.hash, albumId: song.album_id ?? "" },
  };
}

async function albumCover(
  albumId: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (!albumId) {
    return undefined;
  }
  try {
    const body = await fetchJson<AlbumInfo>(
      `http://mobilecdn.kugou.com/api/v3/album/info?albumid=${encodeURIComponent(albumId)}`,
      { signal },
    );
    const template = body.data?.imgurl;
    if (!template) {
      return undefined;
    }
    return template.replace("{size}", "480").replace("http://", "https://");
  } catch {
    return undefined;
  }
}

async function downloadKugouText(
  hit: KugouLyricHit,
  fmt: "krc" | "lrc",
  signal?: AbortSignal,
): Promise<string | null> {
  const download = await fetchJson<LyricDownload>(
    `http://lyrics.kugou.com/download?ver=1&client=pc&id=${encodeURIComponent(hit.id ?? "")}&accesskey=${encodeURIComponent(hit.accesskey ?? "")}&fmt=${fmt}&charset=utf8`,
    { signal },
  );
  return download.content?.trim() || null;
}

async function downloadKugouLyric(
  hit: KugouLyricHit,
  signal?: AbortSignal,
): Promise<{ format: "yrc" | "lrc"; content: string } | null> {
  if (prefersKugouKrc(hit)) {
    try {
      const packed = await downloadKugouText(hit, "krc", signal);
      if (packed) {
        const yrc = krcToYrc(decryptKrc(packed));
        if (validateLyric(yrc, "yrc")) {
          return { format: "yrc", content: yrc };
        }
      }
    } catch {
      // 逐字稿解不开时退回行级 LRC
    }
  }

  const packed = await downloadKugouText(hit, "lrc", signal);
  if (!packed) {
    return null;
  }
  const lrc = Buffer.from(packed, "base64").toString("utf8");
  if (!validateLyric(lrc, "lrc")) {
    return null;
  }
  return { format: "lrc", content: lrc };
}

export async function findKugouAlbumCover(
  query: TrackQuery,
  signal: AbortSignal,
): Promise<string | undefined> {
  if (!query.album.trim()) {
    return undefined;
  }
  try {
    const keyword = `${query.album} ${query.artist}`.trim();
    const body = await fetchJson<SearchResponse>(
      `http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(keyword)}&page=1&pagesize=20&showtype=1`,
      { signal },
    );
    for (const song of body.data?.info ?? []) {
      if (!albumNamesMatch(song.album_name, query.album)) {
        continue;
      }
      const url = await albumCover(song.album_id ?? "", signal);
      if (url) {
        return url;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function lookupKugou(
  query: TrackQuery,
  keyword: string,
  parentSignal?: AbortSignal,
): Promise<ProviderLyric | null> {
  const signal = providerSignal(parentSignal);
  try {
    const body = await fetchJson<SearchResponse>(
      `http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(keyword)}&page=1&pagesize=20&showtype=1`,
      { signal },
    );
    const candidates = (body.data?.info ?? [])
      .map(toCandidate)
      .filter((item): item is LyricCandidate => item !== null);
    const best = pickBestCandidate(candidates, query);
    const hash = best?.extra?.hash;
    if (!best || !hash) {
      return null;
    }

    const durationMs =
      best.duration && best.duration > 0
        ? Math.round(best.duration)
        : Math.round(query.durationMs ?? 0);
    const krcSearch = await fetchJson<LyricSearch>(
      `http://krcs.kugou.com/search?ver=1&man=yes&client=mobi&keyword=${encodeURIComponent(`${query.artist} - ${query.title}`)}&duration=${durationMs}&hash=${encodeURIComponent(hash)}`,
      { signal },
    );
    const hit = krcSearch.candidates?.[0];
    if (!hit?.id || !hit.accesskey) {
      return null;
    }

    const lyric = await downloadKugouLyric(hit, signal);
    if (!lyric) {
      return null;
    }
    return {
      source: "kugou",
      format: lyric.format,
      content: lyric.content,
      candidate: best,
      coverUrl: await albumCover(best.extra?.albumId ?? "", signal),
    };
  } catch {
    return null;
  }
}
