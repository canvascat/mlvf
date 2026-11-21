import { eq } from "drizzle-orm";
import { abortableSleep, streamCommand } from "../../../../src/lib/process";
import type { ReleaseRuntime } from "../../../../src/release/ops";
import type { Db } from "../../db/client";
import {
  albums, runnerState, tracks, type AlbumRow, type TrackRow,
} from "../../db/schema";
import { createDbQueueStore } from "../../queue-store";
import type { JobContext } from "../types";

/** 把设置表里的节奏和可取消的子进程接成 ops 用的运行环境。 */
export function makeReleaseRuntime(ctx: JobContext): ReleaseRuntime {
  const s = ctx.settings;
  return {
    store: createDbQueueStore(ctx.db),
    log: (line) => ctx.log(line),
    sleep: (ms) => abortableSleep(ms, ctx.signal),
    run: async (command) => {
      const result = await streamCommand(command, {
        signal: ctx.signal,
        onLine: (line, stream) => ctx.log(line, stream),
      });
      if (result.aborted) throw new Error("已取消");
      return { exitCode: result.exitCode, output: result.output };
    },
    timing: {
      rateLimitWaitMs: s["retry.rateLimitWaitSec"] * 1000,
      writeIntervalMs: s["season.writeIntervalSec"] * 1000,
      notFoundWaitMs: s["retry.notFoundWaitSec"] * 1000,
      editBusyWaitMs: s["retry.editBusyWaitSec"] * 1000,
      addDelayMs: 4000,
      draftCapacity: s["draft.capacity"],
    },
    biliup: s["bin.biliup"],
    ffmpeg: s["bin.ffmpeg"],
    onHold: (until) => {
      ctx.log(`覆盖稿遇到 137022，暂停投稿到 ${new Date(until).toLocaleString("zh-CN")}`);
      ctx.db.update(runnerState).set({ holdUntil: until }).where(eq(runnerState.id, 1)).run();
    },
  };
}

export function requireTrack(db: Db, id: number | null): TrackRow {
  const row = id == null ? undefined : db.select().from(tracks).where(eq(tracks.id, id)).get();
  if (!row) throw new Error(`找不到曲目 #${id}`);
  if (row.configPath.startsWith("legacy:")) {
    throw new Error("这是旧队列导入的占位曲目，没有备料配置，无法导出");
  }
  return row;
}

export function requireAlbum(db: Db, id: number | null): AlbumRow {
  const row = id == null ? undefined : db.select().from(albums).where(eq(albums.id, id)).get();
  if (!row) throw new Error(`找不到专辑 #${id}`);
  return row;
}

export function markUploadOk(db: Db, now: number): void {
  db.update(runnerState).set({ lastUploadOkAt: now }).where(eq(runnerState.id, 1)).run();
}

/** 距上次成功投稿不足 upload.minIntervalSec 就在任务里等（可取消，任务保持 running）。 */
export async function waitForUploadGap(ctx: JobContext): Promise<void> {
  const state = ctx.db.select().from(runnerState).where(eq(runnerState.id, 1)).get();
  if (state?.lastUploadOkAt == null) return;
  const wait = state.lastUploadOkAt + ctx.settings["upload.minIntervalSec"] * 1000 - Date.now();
  if (wait <= 0) return;
  ctx.log(`距上次成功投稿不足 ${ctx.settings["upload.minIntervalSec"]} 秒，等待 ${Math.ceil(wait / 1000)} 秒`);
  await abortableSleep(wait, ctx.signal);
}
