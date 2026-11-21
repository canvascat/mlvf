import { streamCommand } from "../../../../src/lib/process";
import type { Executor } from "../types";

export type PreparePayload = {
  audio: string;
  out?: string;
  title?: string;
  artist?: string;
  album?: string;
  lyricOffsetMs?: number;
  acceptEdgeCredits?: boolean;
  lyricFormat?: string;
};

export function buildPrepareArgs(payload: PreparePayload): string[] {
  const args = ["src/prepare/cli.ts", "--audio", payload.audio];
  if (payload.out) args.push("--out", payload.out);
  if (payload.title) args.push("--title", payload.title);
  if (payload.artist) args.push("--artist", payload.artist);
  if (payload.album) args.push("--album", payload.album);
  if (payload.lyricOffsetMs !== undefined) args.push("--lyric-offset", String(payload.lyricOffsetMs));
  if (payload.acceptEdgeCredits) args.push("--accept-edge-credits");
  if (payload.lyricFormat) args.push("--lyric-format", payload.lyricFormat);
  return args;
}

export const prepareExecutor: Executor = async (job, ctx) => {
  const payload = job.payload as PreparePayload;
  if (!payload.audio) throw new Error("prepare 任务缺少 audio");
  const result = await streamCommand(["nub", ...buildPrepareArgs(payload)], {
    signal: ctx.signal,
    onLine: (line, stream) => ctx.log(line, stream),
  });
  if (result.aborted) throw new Error("已取消");
  if (result.exitCode !== 0) {
    // 没有歌词时备料会写出 json 但以非 0 退出，见 src/prepare/README.md
    throw new Error(`备料退出码 ${result.exitCode}（没有歌词时 json 仍会写出，查看日志）`);
  }
  return { audio: payload.audio };
};
