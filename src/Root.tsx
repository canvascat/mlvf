import type { FC } from "react";
import { useMemo } from "react";
import "@applemusic-like-lyrics/core/style.css";
import { Composition } from "remotion";
import { AlbumPlayer } from "./Album/Main";
import { PlaylistPlayer } from "./Playlist/Main";
import {
  calculateAlbumMetadata,
  calculatePlayerMetadata,
  calculatePlaylistMetadata,
  calculateSpectraMetadata,
} from "./helpers/calculate-metadata";
import {
  buildDefaultAlbumProps,
  buildDefaultPlayerProps,
  buildDefaultPlaylistProps,
  buildDefaultSpectraProps,
} from "./helpers/default-props";
import {
  albumCompositionSchema,
  playerCompositionSchema,
  playlistCompositionSchema,
  spectraCompositionSchema,
} from "./helpers/schema";
import { Player } from "./Player/Main";
import { SpectraPlayer } from "./Spectra/Main";
import { useStudioPreviewRevision } from "./helpers/use-studio-preview-revision";
import {
  ALBUM_COMPOSITION_ID,
  COMPOSITION_ID,
  PLAYLIST_COMPOSITION_ID,
  SPECTRA_COMPOSITION_ID,
  DEFAULT_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
} from "./remotion/constants";

export const RemotionRoot: FC = () => {
  const previewRevision = useStudioPreviewRevision();

  const playerProps = useMemo(
    () => buildDefaultPlayerProps(),
    [previewRevision],
  );
  const albumProps = useMemo(() => buildDefaultAlbumProps(), [previewRevision]);
  const playlistProps = useMemo(
    () => buildDefaultPlaylistProps(),
    [previewRevision],
  );
  const spectraProps = useMemo(
    () => buildDefaultSpectraProps(),
    [previewRevision],
  );

  return (
    <>
      <Composition
        id={COMPOSITION_ID}
        component={Player}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        fps={DEFAULT_FPS}
        durationInFrames={300}
        schema={playerCompositionSchema}
        defaultProps={playerProps}
        calculateMetadata={calculatePlayerMetadata}
        key={`${COMPOSITION_ID}-${previewRevision}-${playerProps.songName}`}
      />
      <Composition
        id={ALBUM_COMPOSITION_ID}
        component={AlbumPlayer}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        fps={DEFAULT_FPS}
        durationInFrames={300}
        schema={albumCompositionSchema}
        defaultProps={albumProps}
        calculateMetadata={calculateAlbumMetadata}
        key={`${ALBUM_COMPOSITION_ID}-${previewRevision}`}
      />
      <Composition
        id={PLAYLIST_COMPOSITION_ID}
        component={PlaylistPlayer}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        fps={DEFAULT_FPS}
        durationInFrames={300}
        schema={playlistCompositionSchema}
        defaultProps={playlistProps}
        calculateMetadata={calculatePlaylistMetadata}
        key={`${PLAYLIST_COMPOSITION_ID}-${previewRevision}`}
      />
      <Composition
        id={SPECTRA_COMPOSITION_ID}
        component={SpectraPlayer}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        fps={DEFAULT_FPS}
        durationInFrames={300}
        schema={spectraCompositionSchema}
        defaultProps={spectraProps}
        calculateMetadata={calculateSpectraMetadata}
        key={`${SPECTRA_COMPOSITION_ID}-${previewRevision}-${spectraProps.songName}`}
      />
    </>
  );
};