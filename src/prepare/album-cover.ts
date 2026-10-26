import type { CoverSource, TrackQuery } from "./types";
import { findItunesAlbumCover } from "./providers/itunes";
import { findKugouAlbumCover } from "./providers/kugou";
import { findNeteaseAlbumCover } from "./providers/netease";
import { findQqAlbumCover } from "./providers/qqmusic";

export type AlbumCoverHit = {
  url: string;
  source: CoverSource;
};

export async function findAlbumCover(
  query: TrackQuery,
  signal: AbortSignal,
): Promise<AlbumCoverHit | undefined> {
  if (!query.album.trim()) {
    return undefined;
  }
  const found = await Promise.all([
    findQqAlbumCover(query, signal).then((url) =>
      url ? { url, source: "qqmusic" as const } : undefined,
    ),
    findNeteaseAlbumCover(query, signal).then((url) =>
      url ? { url, source: "netease" as const } : undefined,
    ),
    findKugouAlbumCover(query, signal).then((url) =>
      url ? { url, source: "kugou" as const } : undefined,
    ),
    findItunesAlbumCover(query, signal).then((url) =>
      url ? { url, source: "itunes" as const } : undefined,
    ),
  ]);
  return found.find((item) => item !== undefined);
}
