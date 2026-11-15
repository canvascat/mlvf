import type {
  AlbumCompositionProps,
  PlayerCompositionProps,
  PlaylistCompositionProps,
  SpectraCompositionProps,
} from "./schema";
import {
  ALBUM_COMPOSITION_ID,
  COMPOSITION_ID,
  PLAYLIST_COMPOSITION_ID,
  SPECTRA_COMPOSITION_ID,
} from "../remotion/constants";
import { studioPreviewOverride } from "./studio-preview.generated";

export type StudioPreviewOverride =
  | { compositionId: typeof COMPOSITION_ID; props: PlayerCompositionProps }
  | { compositionId: typeof ALBUM_COMPOSITION_ID; props: AlbumCompositionProps }
  | {
      compositionId: typeof PLAYLIST_COMPOSITION_ID;
      props: PlaylistCompositionProps;
    }
  | {
      compositionId: typeof SPECTRA_COMPOSITION_ID;
      props: SpectraCompositionProps;
    };

export { studioPreviewOverride };

export function resolveStudioDefault<P>(
  compositionId: string,
  fallback: P,
): P {
  if (
    studioPreviewOverride &&
    studioPreviewOverride.compositionId === compositionId
  ) {
    return studioPreviewOverride.props as P;
  }
  return fallback;
}