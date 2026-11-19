import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type ReleaseTrack = {
  index: number;
  configPath: string;
  songName: string;
  artistName: string;
  albumName: string;
  audioPath: string;
  lyricPath?: string;
  textPath: string;
};

type TrackJson = {
  songName?: string;
  artistName?: string;
  albumName?: string;
  audioFileUrl?: string;
  lyricsFileUrl?: string;
};

export async function listReleaseTracks(
  dir: string,
  readTrack: (audioPath: string) => Promise<number | null>,
): Promise<ReleaseTrack[]> {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".json"));
  const pending = await Promise.all(names.map(async (name) => {
    const configPath = path.join(dir, name);
    const data = JSON.parse(await readFile(configPath, "utf8")) as TrackJson;
    const audioPath = path.join(dir, data.audioFileUrl ?? "");
    const lyricPath = data.lyricsFileUrl
      ? path.join(dir, data.lyricsFileUrl)
      : undefined;
    const trackNumber = await readTrack(audioPath);
    return {
      configPath,
      songName: data.songName ?? "",
      artistName: data.artistName ?? "",
      albumName: data.albumName ?? "",
      audioPath,
      lyricPath,
      textPath: configPath.replace(/\.json$/, ".txt"),
      trackNumber,
    };
  }));
  pending.sort((a, b) => {
    if (a.trackNumber != null && b.trackNumber != null) {
      return a.trackNumber - b.trackNumber;
    }
    if (a.trackNumber != null) return -1;
    if (b.trackNumber != null) return 1;
    return path.basename(a.configPath).localeCompare(
      path.basename(b.configPath),
      "zh-Hans",
    );
  });
  return pending.map((track, index) => ({
    index: index + 1,
    configPath: track.configPath,
    songName: track.songName,
    artistName: track.artistName,
    albumName: track.albumName,
    audioPath: track.audioPath,
    lyricPath: track.lyricPath,
    textPath: track.textPath,
  }));
}
