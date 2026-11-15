import { staticFile } from "remotion";
import oneLastKiss from "../../public/OneLastKiss.json";
import tiehe from "../../public/周杰伦 - 半岛铁盒.json";
import { resolveStudioDefault } from "./studio-preview";
import {
  ALBUM_COMPOSITION_ID,
  COMPOSITION_ID,
  PLAYLIST_COMPOSITION_ID,
  SPECTRA_COMPOSITION_ID,
} from "../remotion/constants";
import type {
  AlbumCompositionProps,
  PlayerCompositionProps,
  PlaylistCompositionProps,
  SpectraCompositionProps,
} from "./schema";

type PreparedSong = {
  audioFileUrl: string;
  lyricsFileUrl: string;
  coverImageUrl?: string;
  audioOffsetInSeconds: number;
  songName: string;
  artistName: string;
  albumName: string;
  durationInSeconds: number;
  lyricOffsetMs?: number;
};

function trackFromPrepared(prepared: PreparedSong): PlayerCompositionProps {
  return {
    audioOffsetInSeconds: prepared.audioOffsetInSeconds,
    audioFileUrl: staticFile(prepared.audioFileUrl),
    lyricsFileUrl: staticFile(prepared.lyricsFileUrl),
    coverImageUrl: prepared.coverImageUrl
      ? staticFile(prepared.coverImageUrl)
      : undefined,
    songName: prepared.songName,
    artistName: prepared.artistName,
    albumName: prepared.albumName,
    durationInSeconds: prepared.durationInSeconds,
    lyricOffsetMs: prepared.lyricOffsetMs,
  };
}

const defaultTrack: PlayerCompositionProps = {
  ...trackFromPrepared(oneLastKiss),
  backgroundMotion: "slow",
};

const builtInPlaylistProps: PlaylistCompositionProps = {
  tracks: [
    trackFromPrepared(oneLastKiss),
    trackFromPrepared(tiehe),
  ],
};

const builtInSpectraProps: SpectraCompositionProps =
  trackFromPrepared(oneLastKiss);

export const defaultPlayerProps: PlayerCompositionProps = resolveStudioDefault(
  COMPOSITION_ID,
  defaultTrack,
);

export const defaultSpectraProps: SpectraCompositionProps = resolveStudioDefault(
  SPECTRA_COMPOSITION_ID,
  builtInSpectraProps,
);

const builtInAlbumProps: AlbumCompositionProps = {
  audioFileUrl: defaultTrack.audioFileUrl,
  coverImageUrl: defaultTrack.coverImageUrl,
  artistName: defaultTrack.artistName,
  albumName: defaultTrack.albumName,
  tracks: [
    {
      songName: defaultTrack.songName,
      audioOffsetInSeconds: defaultTrack.audioOffsetInSeconds,
      audioEndInSeconds: oneLastKiss.durationInSeconds,
    },
  ],
};

export const defaultPlaylistProps: PlaylistCompositionProps =
  resolveStudioDefault(PLAYLIST_COMPOSITION_ID, builtInPlaylistProps);

export const defaultAlbumProps: AlbumCompositionProps = resolveStudioDefault(
  ALBUM_COMPOSITION_ID,
  builtInAlbumProps,
);
