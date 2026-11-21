import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { exportVideo } from "../../../../src/export/render";
import { tracks } from "../../db/schema";
import { isProgressLine, parseRenderProgress } from "../progress";
import type { Executor } from "../types";
import { requireTrack } from "./support";

export type ExportPayload = { configPath: string; outPath: string; overwriteVideo: boolean };

export const exportExecutor: Executor = async (job, ctx) => {
  const payload = job.payload as ExportPayload;
  const track = requireTrack(ctx.db, job.trackId);
  const setStatus = (exportStatus: "exported" | "failed") =>
    ctx.db.update(tracks).set({ exportStatus }).where(eq(tracks.id, track.id)).run();
  if (!payload.overwriteVideo && existsSync(payload.outPath)) {
    ctx.log(`成片已存在，跳过渲染 ${payload.outPath}`);
    setStatus("exported");
    return { out: payload.outPath, skipped: true };
  }
  let lastProgressLogAt = 0;
  try {
    const out = await exportVideo(
      {
        config: payload.configPath,
        out: payload.outPath,
        fps: 30,
        concurrency: ctx.settings["render.frameConcurrency"],
      },
      {
        signal: ctx.signal,
        onLog: (line, stream) => {
          if (isProgressLine(line)) {
            const progress = parseRenderProgress(line);
            if (progress != null) ctx.progress(progress);
            // 进度行很密，日志里每 5 秒留一条
            const now = Date.now();
            if (now - lastProgressLogAt < 5000) return;
            lastProgressLogAt = now;
          }
          ctx.log(line, stream);
        },
      },
    );
    setStatus("exported");
    ctx.progress(1);
    return { out, skipped: false };
  } catch (error) {
    if (!ctx.signal.aborted) setStatus("failed");
    throw error;
  }
};
