export function hiresFor(input: {
  lossless: boolean;
  sampleRate: number;
  bitsPerSample: number;
}): 0 | 1 {
  const hires = input.lossless && (
    input.sampleRate >= 96000
    || (input.sampleRate >= 48000 && input.bitsPerSample >= 24)
  );
  return hires ? 1 : 0;
}

export function albumDynamic(artist: string, album: string): string {
  return `${artist}《${album}》整张专辑`;
}

export function dynamicForTrack(
  index: number,
  artist: string,
  album: string,
  already: boolean,
): string {
  if (already || index !== 1) return "";
  return albumDynamic(artist, album);
}
