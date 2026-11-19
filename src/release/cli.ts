import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { exportVideo } from "../export/render";
import { exportAndEnqueue } from "./export-batch";
import {
  biliCall,
  cookiePath,
  listSeasons,
  loadQueue,
  probeAudio,
  queuePath,
  readCookies,
  readTrackNumber,
  runCommand,
  saveQueue,
  sleep,
  trimNewPart,
} from "./io";
import { listReleaseTracks, type ReleaseTrack } from "./order";
import { pendingOf, releaseItemId, type QueueFile, type QueueItem } from "./queue";
import { nextUpload, type ScheduleState } from "./schedule";
import { classifySeasonAdd, ensureSeason } from "./season";
import { uploadItem } from "./upload-one";

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

function outDirFor(prepareDir: string): string {
  return path.join(process.cwd(), "out", path.basename(prepareDir));
}

async function trackFromConfig(configPath: string): Promise<ReleaseTrack> {
  const dir = path.dirname(path.resolve(configPath));
  const tracks = await listReleaseTracks(dir, readTrackNumber);
  const resolved = path.resolve(configPath);
  const found = tracks.find((track) => path.resolve(track.configPath) === resolved);
  if (!found) throw new Error(`找不到配置 ${configPath}`);
  return found;
}

async function stampSeason(
  prepareDir: string,
  tracks: ReleaseTrack[],
): Promise<{ seasonId: number; sectionId: number }> {
  const first = tracks[0];
  if (!first) throw new Error(`目录里没有曲目 ${prepareDir}`);
  const cover = ["cover.jpg", "Cover.jpg"].map((name) => path.join(prepareDir, name))
    .find((file) => existsSync(file));
  if (!cover) throw new Error(`备料目录没有专辑封面 ${prepareDir}`);
  const jpeg = path.join(process.cwd(), "tmp", "release-season-cover.jpg");
  const converted = await runCommand([
    "ffmpeg", "-y", "-i", cover, "-frames:v", "1", "-q:v", "3", jpeg,
  ]);
  if (converted.exitCode !== 0) throw new Error("封面转 JPEG 失败");
  const season = await ensureSeason({
    title: `${first.artistName} ${first.albumName}`,
    sectionTitle: first.albumName,
    desc: `${first.artistName}专辑《${first.albumName}》的歌词视频。`,
    coverPath: jpeg,
    client: {
      list: listSeasons,
      uploadCover: async (file) => {
        const { csrf } = await readCookies();
        const bytes = await readFile(file);
        const body = await biliCall(
          "POST",
          "https://member.bilibili.com/x/vu/web/cover/up",
          new URLSearchParams({
            cover: `data:image/jpeg;base64,${bytes.toString("base64")}`,
            csrf,
          }).toString(),
          "application/x-www-form-urlencoded",
        );
        if (body.code !== 0) throw new Error(`封面上传失败 ${body.code} ${body.message ?? ""}`);
        return String((body.data as { url?: string }).url ?? "");
      },
      create: async (fields) => {
        const { csrf } = await readCookies();
        const body = await biliCall(
          "POST",
          "https://member.bilibili.com/x2/creative/web/season/add",
          new URLSearchParams({ ...fields, season_price: "0", csrf }).toString(),
          "application/x-www-form-urlencoded",
        );
        if (body.code !== 0) throw new Error(body.message ?? "创建合集失败");
        return Number(body.data);
      },
      switchGroup: async (seasonId) => {
        const { csrf } = await readCookies();
        const body = await biliCall(
          "POST",
          "https://member.bilibili.com/x2/creative/web/season/section/switch",
          new URLSearchParams({
            csrf, season_id: String(seasonId), no_section: "0",
          }).toString(),
          "application/x-www-form-urlencoded",
        );
        if (body.code !== 0 && body.code !== 20081) {
          throw new Error(body.message ?? "打开合集分组失败");
        }
      },
      renameSection: async (seasonId, sectionId, title) => {
        const { csrf } = await readCookies();
        const body = await biliCall(
          "POST",
          `https://member.bilibili.com/x2/creative/web/season/section/edit?csrf=${csrf}`,
          JSON.stringify({
            section: { id: sectionId, type: 1, seasonId, title },
            sorts: [],
          }),
          "application/json",
        );
        if (body.code !== 0) throw new Error(body.message ?? "重命名小节失败");
      },
      pause: () => sleep(4000),
    },
  });
  const queue = await loadQueue();
  const ids = new Set(tracks.map((track) => releaseItemId(prepareDir, track.index)));
  for (const item of queue.items) {
    if (ids.has(item.id)) {
      item.season_id = season.seasonId;
      item.section_id = season.sectionId;
    }
  }
  await saveQueue(queue);
  console.log(`合集 ${season.seasonId} 小节 ${season.sectionId}`);
  return season;
}

function rememberSeason(id: string, season: { seasonId: number; sectionId: number }) {
  const queue = JSON.parse(readFileSync(queuePath, "utf8")) as QueueFile;
  const item = queue.items.find((entry) => entry.id === id);
  if (!item) return;
  item.season_id = season.seasonId;
  item.section_id = season.sectionId;
  writeFileSync(queuePath, JSON.stringify(queue, null, 2) + "\n");
}

async function writeCover(track: ReleaseTrack, video: string, cover: string): Promise<void> {
  let seconds = "2";
  if (track.lyricPath && existsSync(track.lyricPath)) {
    const timed = await runCommand([
      "nub", "tmp/lyric-cover-time.ts", track.lyricPath, track.songName, track.artistName,
    ]);
    const line = timed.output.trim().split("\n").at(-1);
    if (timed.exitCode === 0 && line && Number.isFinite(Number(line))) seconds = line;
  }
  const shot = await runCommand([
    "ffmpeg", "-y", "-ss", seconds, "-i", video,
    "-frames:v", "1", "-update", "1", "-q:v", "2", cover,
  ]);
  if (shot.exitCode !== 0 || !existsSync(cover)) throw new Error(`抽封面失败 ${track.songName}`);
}

async function assertNoOtherUpload(): Promise<void> {
  const found = await runCommand(["pgrep", "-fl", "biliup upload|biliup append|src/release/cli.ts"]);
  const others = found.output.split("\n").map((line) => line.trim()).filter((line) => {
    const pid = Number(line.split(" ", 1)[0]);
    return line && pid !== process.pid && !line.includes("pgrep");
  });
  if (others.length > 0) throw new Error("已有投稿在进行");
}

function fieldFrom(output: string, name: "filename" | "cid"): string | null {
  const patterns = name === "filename"
    ? [/"filename"\s*:\s*"([^"]+)"/, /filename:\s*String\("([^"]+)"\)/]
    : [/"cid"\s*:\s*(\d+)/, /cid:\s*Number\((\d+)\)/];
  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

async function saveDraft(item: QueueItem, output: string): Promise<string> {
  const filename = fieldFrom(output, "filename");
  const cid = fieldFrom(output, "cid");
  if (!filename || !cid) throw new Error("投稿输出里没有 filename 和 cid，不重新上传");
  const { csrf } = await readCookies();
  const listed = await biliCall(
    "GET",
    "https://member.bilibili.com/x/vupre/web/draft/list?pn=1&ps=30",
  );
  const count = Array.isArray(listed.data) ? listed.data.length : 0;
  if (30 - count <= 0) throw new Error("草稿箱已满，剩下的留在队列");
  const saved = await biliCall(
    "POST",
    `https://member.bilibili.com/x/vupre/web/draft/add?csrf=${csrf}`,
    JSON.stringify({
      copyright: item.upload.copyright,
      tid: item.upload.tid,
      title: item.upload.title,
      desc: item.upload.desc,
      tag: item.upload.tag,
      cover: item.upload.cover,
      dynamic: item.upload.dynamic,
      videos: [{ filename, title: item.title, cid: Number(cid) }],
    }),
    "application/json",
  );
  if (saved.code !== 0) throw new Error(`存草稿失败 ${saved.code} ${saved.message ?? ""}`);
  await sleep(3000);
  return String((saved.data as { id?: number } | undefined)?.id ?? saved.data);
}

async function addToSeason(item: QueueItem, bvid: string): Promise<boolean> {
  if (!item.section_id) return false;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    await sleep(attempt === 0 ? 4000 : 30_000);
    const result = await runCommand([
      "biliup", "-u", cookiePath, "season", "add", String(item.section_id), "--vid", bvid,
    ]);
    const kind = classifySeasonAdd(result.exitCode, result.output);
    console.log(result.output.slice(-800));
    if (kind === "ok") return true;
    if (kind === "wait-rate" || kind === "wait-missing") continue;
    return false;
  }
  return false;
}

function patchQueueItem(id: string, update: (item: QueueItem) => void): QueueItem | undefined {
  const queue = JSON.parse(readFileSync(queuePath, "utf8")) as QueueFile;
  const item = queue.items.find((entry) => entry.id === id);
  if (!item) return;
  update(item);
  writeFileSync(queuePath, JSON.stringify(queue, null, 2) + "\n");
  return item;
}

async function uploadById(id: string, uploaded: Set<string>): Promise<"uploaded" | "skipped"> {
  const queue = await loadQueue();
  const item = queue.items.find((entry) => entry.id === id || entry.video === id);
  if (!item || item.status !== "pending") throw new Error(`找不到待投稿 ${id}`);
  if (uploaded.has(item.video)) return "skipped";
  const result = await uploadItem(item, {
    cookie: cookiePath,
    run: runCommand,
    sleep,
    saveDraft,
  });
  uploaded.add(item.video);
  if (result.status === "draft") {
    patchQueueItem(item.id, (current) => {
      current.status = "draft";
      current.draft_id = result.draftId;
    });
    throw new Error(`投稿过于频繁，已从 ${item.title} 停止`);
  }
  if (item.mode === "overwrite" && item.bvid) {
    try {
      await trimNewPart(item.bvid, item.title, item.upload.hires);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    }
  }
  const current = patchQueueItem(item.id, (entry) => {
    entry.status = "done";
    entry.bvid = result.bvid;
    entry.finished = new Date().toISOString();
    entry.season_added = false;
  });
  if (!current) return "uploaded";
  const added = await addToSeason(current, result.bvid);
  patchQueueItem(item.id, (entry) => { entry.season_added = added; });
  console.log(`投稿完成 ${current.title} ${result.bvid}`);
  return "uploaded";
}

async function runBatch(mode: "then" | "and", prepareDir: string, overwriteVideo: boolean) {
  const dir = path.resolve(prepareDir);
  const tracks = await listReleaseTracks(dir, readTrackNumber);
  const season = await stampSeason(dir, tracks);
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
  const refresh = async () => {
    const queue = await loadQueue();
    state.now = Date.now();
    state.pendingReady = pendingOf(queue, ids, uploaded)
      .filter((item) => existsSync(item.video))
      .map((item) => item.id);
  };
  const kick = () => {
    uploadChain = uploadChain.then(async () => {
      while (!stopped) {
        await refresh();
        const decision = nextUpload(state);
        if (decision.type === "stop" || decision.type === "idle") return;
        if (decision.type === "wait") {
          await sleep(decision.ms);
          continue;
        }
        state.uploading = true;
        try {
          const outcome = await uploadById(decision.id, uploaded);
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
      loadQueue: () => JSON.parse(readFileSync(queuePath, "utf8")) as QueueFile,
      saveQueue: (queue) => writeFileSync(queuePath, JSON.stringify(queue, null, 2) + "\n"),
      onEnqueued: (id) => {
        rememberSeason(id, season);
        if (mode === "and") kick();
      },
      writeCover,
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
  if (args.command === "export") {
    const track = await trackFromConfig(args.target);
    await exportAndEnqueue({
      tracks: [track],
      outDir: outDirFor(path.dirname(path.resolve(args.target))),
      prepareDir: path.dirname(path.resolve(args.target)),
      overwriteVideo: args.overwriteVideo,
      exportVideo: async (config, out) => {
        await exportVideo({ config, out, fps: 30, concurrency: "1" });
      },
      fileExists: existsSync,
      probe: probeAudio,
      readText: (file) => readFileSync(file, "utf8"),
      loadQueue: () => JSON.parse(readFileSync(queuePath, "utf8")) as QueueFile,
      saveQueue: (queue) => writeFileSync(queuePath, JSON.stringify(queue, null, 2) + "\n"),
      onEnqueued: (id) => console.log(`已入队 ${id}`),
      writeCover,
    });
    return;
  }
  if (args.command === "upload" || args.command.endsWith("upload")) {
    await assertNoOtherUpload();
  }
  if (args.command === "upload") {
    await uploadById(args.target, new Set());
    return;
  }
  if (args.command === "season") {
    const dir = path.resolve(args.target);
    await stampSeason(dir, await listReleaseTracks(dir, readTrackNumber));
    return;
  }
  await runBatch(
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

