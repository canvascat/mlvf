import { albumNamesMatch, pickBestCandidate } from "../match";
import { fetchJson, providerSignal } from "../http";
import type { ItunesHit, LyricCandidate, TrackQuery } from "../types";

type ItunesSong = {
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  trackTimeMillis?: number;
  artworkUrl100?: string;
};

type ItunesResponse = {
  results?: ItunesSong[];
};

function artworkUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  return url.replace(/100x100/g, "600x600");
}

function toCandidate(song: ItunesSong): LyricCandidate | null {
  if (!song.trackName) {
    return null;
  }
  return {
    name: song.trackName,
    artist: song.artistName ?? "",
    album: song.collectionName,
    duration: song.trackTimeMillis,
    extra: { cover: artworkUrl(song.artworkUrl100) ?? "" },
  };
}

async function searchStore(
  keyword: string,
  country: string | undefined,
  signal?: AbortSignal,
): Promise<LyricCandidate[]> {
  try {
    const params = new URLSearchParams({
      term: keyword,
      entity: "song",
      limit: "10",
    });
    if (country) {
      params.set("country", country);
    }
    const body = await fetchJson<ItunesResponse>(
      `https://itunes.apple.com/search?${params.toString()}`,
      { signal },
    );
    return (body.results ?? [])
      .map(toCandidate)
      .filter((item): item is LyricCandidate => item !== null);
  } catch {
    return [];
  }
}

function dedupe(candidates: LyricCandidate[]): LyricCandidate[] {
  const seen = new Set<string>();
  const out: LyricCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.name}\0${candidate.artist}\0${candidate.album ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

type ItunesAlbum = {
  collectionName?: string;
  artworkUrl100?: string;
};

export async function findItunesAlbumCover(
  query: TrackQuery,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (!query.album.trim()) {
    return undefined;
  }
  const countries = [undefined, "jp", "hk"] as const;
  for (const country of countries) {
    try {
      const params = new URLSearchParams({
        term: query.album,
        entity: "album",
        limit: "10",
      });
      if (country) {
        params.set("country", country);
      }
      const body = await fetchJson<{ results?: ItunesAlbum[] }>(
        `https://itunes.apple.com/search?${params.toString()}`,
        { signal },
      );
      for (const album of body.results ?? []) {
        if (!albumNamesMatch(album.collectionName, query.album)) {
          continue;
        }
        const url = artworkUrl(album.artworkUrl100);
        if (url) {
          return url;
        }
      }
    } catch {
      // 换一个国家再试
    }
  }
  return undefined;
}

export async function lookupItunes(
  query: TrackQuery,
  keyword: string,
  parentSignal?: AbortSignal,
): Promise<ItunesHit | null> {
  const signal = providerSignal(parentSignal);
  try {
    const lists = await Promise.all([
      searchStore(keyword, undefined, signal),
      searchStore(keyword, "hk", signal),
      searchStore(keyword, "jp", signal),
    ]);
    const candidates = dedupe(lists.flat());
    const best =
      pickBestCandidate(candidates, query) ??
      pickBestCandidate(candidates, { ...query, artist: "" });
    if (!best) {
      return null;
    }
    return {
      candidate: best,
      coverUrl: best.extra?.cover || undefined,
    };
  } catch {
    return null;
  }
}
