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
import { studioPreviewOverride as initialStudioPreviewOverride } from "./studio-preview.generated";

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

let liveStudioPreviewOverride: StudioPreviewOverride | null =
  initialStudioPreviewOverride;
let studioPreviewRevision = 0;
const studioPreviewListeners = new Set<() => void>();

type ViteHot = {
  accept: (
    path: string,
    cb: (mod: typeof import("./studio-preview.generated")) => void,
  ) => void;
};

const viteHot = (import.meta as ImportMeta & { hot?: ViteHot }).hot;
if (viteHot) {
  viteHot.accept("./studio-preview.generated.ts", (mod) => {
    if (!mod) {
      return;
    }
    liveStudioPreviewOverride = mod.studioPreviewOverride;
    studioPreviewRevision += 1;
    for (const listener of studioPreviewListeners) {
      listener();
    }
  });
}

export function getStudioPreviewOverride(): StudioPreviewOverride | null {
  return liveStudioPreviewOverride;
}

export function getStudioPreviewRevision(): number {
  return studioPreviewRevision;
}

export function subscribeStudioPreview(listener: () => void): () => void {
  studioPreviewListeners.add(listener);
  return () => studioPreviewListeners.delete(listener);
}

export function resolveStudioDefault<P>(
  compositionId: string,
  fallback: P,
): P {
  const override = getStudioPreviewOverride();
  if (override && override.compositionId === compositionId) {
    return override.props as P;
  }
  return fallback;
}