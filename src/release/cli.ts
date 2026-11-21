import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { bootDb } from "../../admin/server/boot";
import { registerPrepareDir } from "../../admin/server/library";
import { createDbQueueStore } from "../../admin/server/queue-store";
import type { Db } from "../../admin/server/db/client";
import { exportVideo } from "../export/render";
import { exportAndEnqueue, outDirFor } from "./export-batch";
import { probeAudio, readTrackNumber } from "./io";
import { listReleaseTracks, type ReleaseTrack } from "./order";
import {
  assertNoOtherUpload,
  defaultRuntime,
  stampSeason,
  uploadById,
  writeCover,
  type ReleaseRuntime,
} from "./ops";
import { pendingOf, releaseItemId } from "./queue";
import { nextUpload, type ScheduleState } from "./schedule";

const COMMANDS = [
  "export",
  "upload",
  "season",
  "export-then-upload",
  "export-and-upload",
] as const;

export type ReleaseArgs = {
  command: (typeof COMMANDS)[number];
  target: string;
  overwriteVideo: boolean;
};

export function parseReleaseArgs(argv: string[]): ReleaseArgs {
  const overwriteVideo = argv.includes("--overwrite-video");
  const args = argv.filter((arg) => arg !== "--overwrite-video" && arg !== "--");
  const command = args[0];
  const target = args[1];
  if (!COMMANDS.includes(command as ReleaseArgs["command"]) || !target) {
    throw new Error(`用法: nub run release -- ${COMMANDS.join("|")} <目标>`);
  }
  return {
    command: command as ReleaseArgs["command"],
    target,
    overwriteVideo,
  };
}


const REGISTER_DEPS = { readTrackNumber, probe: probeAudio };

async function trackFromConfig(configPath: string): Promise<ReleaseTrack> {
  const dir = path.dirname(path.resolve(configPath));
  const tracks = await listReleaseTracks(dir, readTrackNumber);
  const resolved = path.resolve(configPath);
  const found = tracks.find((track) => path.resolve(track.configPath) === resolved);
  if (!found) throw new Error(`找不到配置 ${configPath}`);
  return found;
}

async function runBatch(
  rt: ReleaseRuntime,
  db: Db,
  mode: "then" | "and",
  prepareDir: string,
  overwriteVideo: boolean,
) {
  const dir = path.resolve(prepareDir);
  await registerPrepareDir(db, dir, REGISTER_DEPS);
  const tracks = await listReleaseTracks(dir, readTrackNumber);
  const season = await stampSeason(rt, dir, tracks);
  const ids = tracks.map((track) => releaseItemId(dir, track.index));
  const state: ScheduleState = {
    mode,
    exportDone: false,
    uploading: false,
    now: Date.now(),
    lastUploadOkAt: null,
    pendingReady: [],
  };
  let uploadChain = Promise.resolve();
  let stopped = false;
  let uploadError: unknown;
  const uploaded = new Set<string>();
  const refresh = () => {
    const queue = rt.store.load();
    state.now = Date.now();
    state.pendingReady = pendingOf(queue, ids, uploaded)
      .filter((item) => existsSync(item.video))
      .map((item) => item.id);
  };
  const kick = () => {
    uploadChain = uploadChain.then(async () => {
      while (!stopped) {
        refresh();
        const decision = nextUpload(state);
        if (decision.type === "stop" || decision.type === "idle") return;
        if (decision.type === "wait") {
          await rt.sleep(decision.ms);
          continue;
        }
        state.uploading = true;
        try {
          const outcome = await uploadById(rt, decision.id, uploaded);
          if (outcome === "uploaded") state.lastUploadOkAt = Date.now();
        } catch (error) {
          stopped = true;
          throw error;
        } finally {
          state.uploading = false;
        }
      }
    }).catch((error) => {
      stopped = true;
      uploadError = error;
      console.error(error instanceof Error ? error.message : error);
    });
  };
  let exportError: unknown;
  try {
    await exportAndEnqueue({
      tracks,
      outDir: outDirFor(dir),
      prepareDir: dir,
      overwriteVideo,
      exportVideo: async (config, out) => {
        await exportVideo({ config, out, fps: 30, concurrency: "1" });
      },
      fileExists: existsSync,
      probe: probeAudio,
      readText: (file) => readFileSync(file, "utf8"),
      loadQueue: () => rt.store.load(),
      saveQueue: (queue) => rt.store.save(queue),
      onEnqueued: (id) => {
        rt.store.patch(id, (item) => {
          item.season_id = season.seasonId;
          item.section_id = season.sectionId;
        });
        if (mode === "and") kick();
      },
      writeCover: (track, video, cover) => writeCover(rt, track, video, cover),
    });
  } catch (error) {
    exportError = error;
  }
  state.exportDone = true;
  if (mode === "and" || !exportError) kick();
  await uploadChain;
  if (exportError) throw exportError;
  if (uploadError) throw uploadError;
}

export async function main(argv: string[]): Promise<void> {
  const args = parseReleaseArgs(argv);
  const db = bootDb();
  const rt = defaultRuntime(createDbQueueStore(db));
  if (args.command === "export") {
    const dir = path.dirname(path.resolve(args.target));
    await registerPrepareDir(db, dir, REGISTER_DEPS);
    const track = await trackFromConfig(args.target);
    await exportAndEnqueue({
      tracks: [track],
      outDir: outDirFor(dir),
      prepareDir: dir,
      overwriteVideo: args.overwriteVideo,
      exportVideo: async (config, out) => {
        await exportVideo({ config, out, fps: 30, concurrency: "1" });
      },
      fileExists: existsSync,
      probe: probeAudio,
      readText: (file) => readFileSync(file, "utf8"),
      loadQueue: () => rt.store.load(),
      saveQueue: (queue) => rt.store.save(queue),
      onEnqueued: (id) => console.log(`已入队 ${id}`),
      writeCover: (entry, video, cover) => writeCover(rt, entry, video, cover),
    });
    return;
  }
  if (args.command === "upload" || args.command.endsWith("upload")) {
    await assertNoOtherUpload(rt);
  }
  if (args.command === "upload") {
    await uploadById(rt, args.target);
    return;
  }
  if (args.command === "season") {
    const dir = path.resolve(args.target);
    await registerPrepareDir(db, dir, REGISTER_DEPS);
    await stampSeason(rt, dir, await listReleaseTracks(dir, readTrackNumber));
    return;
  }
  await runBatch(
    rt,
    db,
    args.command === "export-then-upload" ? "then" : "and",
    args.target,
    args.overwriteVideo,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}