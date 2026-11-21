import path from "node:path";
import { dynamicForTrack, hiresFor } from "./media";
import type { ReleaseTrack } from "./order";
import {
  pendingOf,
  releaseItemId,
  upsertPending,
  type QueueFile,
  type QueueItem,
} from "./queue";

export type ExportBatchOptions = {
  tracks: ReleaseTrack[];
  outDir: string;
  prepareDir: string;
  overwriteVideo: boolean;
  exportVideo: (config: string, out: string) => Promise<void>;
  fileExists: (file: string) => boolean;
  probe: (audio: string) => Promise<{
    lossless: boolean;
    sampleRate: number;
    bitsPerSample: number;
  }>;
  readText: (file: string) => string;
  loadQueue: () => QueueFile;
  saveQueue: (queue: QueueFile) => void;
  onEnqueued: (id: string) => void;
  writeCover?: (track: ReleaseTrack, video: string, cover: string) => Promise<void>;
};

function readBlurb(text: string): { title: string; desc: string } {
  const [head, body] = text.split("\n\n简介\n");
  return {
    title: (head ?? "").replace(/^标题\n/, "").trim(),
    desc: (body ?? "").trim(),
  };
}

function createdAt(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick("minute")}:${pick("second")}+08:00`;
}

export async function exportAndEnqueue(options: ExportBatchOptions): Promise<void> {
  const ids = options.tracks.map((track) => releaseItemId(options.prepareDir, track.index));
  for (const track of options.tracks) {
    const video = videoPathFor(options.outDir, track.artistName, track.songName);
    const cover = video.replace(/\.mkv$/, ".jpg");
    if (options.overwriteVideo || !options.fileExists(video)) {
      await options.exportVideo(track.configPath, video);
    }
    if (options.writeCover) {
      await options.writeCover(track, video, cover);
    }
    const audio = await options.probe(track.audioPath);
    const blurb = readBlurb(options.readText(track.textPath));
    let queue = options.loadQueue();
    const already = pendingOf(queue, ids).some((item) => item.upload.dynamic);
    const item: QueueItem = {
      id: releaseItemId(options.prepareDir, track.index),
      mode: "first",
      status: "pending",
      video,
      title: blurb.title,
      created: createdAt(),
      upload: {
        title: blurb.title,
        desc: blurb.desc,
        tag: [track.artistName, track.albumName, "歌词视频", track.songName].join(","),
        cover,
        tid: 130,
        copyright: 1,
        dynamic: dynamicForTrack(track.index, track.artistName, track.albumName, already),
        hires: hiresFor(audio),
      },
    };
    queue = upsertPending(queue, item);
    options.saveQueue(queue);
    options.onEnqueued(item.id);
  }
}

export function outDirFor(prepareDir: string, cwd: string = process.cwd()): string {
  return path.join(cwd, "out", path.basename(prepareDir));
}

export function videoPathFor(outDir: string, artistName: string, songName: string): string {
  return path.join(outDir, `${artistName}-${songName}.mkv`);
}
