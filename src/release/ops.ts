import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  biliCall,
  cookiePath,
  listSeasons,
  readCookies,
  runCommand,
  sleep,
  trimNewPart,
} from "./io";
import type { ReleaseTrack } from "./order";
import { batchKey, releaseItemId, type QueueItem } from "./queue";
import { classifySeasonAdd, ensureSeason } from "./season";
import type { QueueStore } from "./store";
import { uploadItem } from "./upload-one";

export type RunResult = { exitCode: number; output: string };

export type ReleaseTiming = {
  /** 21566 之后等多久再试同一条。 */
  rateLimitWaitMs: number;
  /** 合集、草稿的写操作之间至少隔多久。 */
  writeIntervalMs: number;
  /** 新稿件加合集返回 -404 / 「啥都木有」之后等多久。 */
  notFoundWaitMs: number;
  /** 20111 / 256000「编辑过于频繁」之后等多久。 */
  editBusyWaitMs: number;
  /** 投稿成功后，第一次加合集前等多久。 */
  addDelayMs: number;
  /** 草稿箱容量。 */
  draftCapacity: number;
};

/** CLI 用的默认值，与重构前的行为一致。runner 用设置表里的值。 */
export const DEFAULT_TIMING: ReleaseTiming = {
  rateLimitWaitMs: 180_000,
  writeIntervalMs: 4000,
  notFoundWaitMs: 30_000,
  editBusyWaitMs: 30_000,
  addDelayMs: 4000,
  draftCapacity: 30,
};

export type ReleaseRuntime = {
  store: QueueStore;
  log: (line: string) => void;
  /** runner 里是可取消的等待。 */
  sleep: (ms: number) => Promise<void>;
  run: (command: string[]) => Promise<RunResult>;
  timing: ReleaseTiming;
  biliup: string;
  ffmpeg: string;
  /** 覆盖稿遇到 137022 时调用，参数是次日 00:00。runner 把它写进 runner_state.hold_until。 */
  onHold?: (until: number) => void;
};

export function defaultRuntime(store: QueueStore): ReleaseRuntime {
  return {
    store,
    log: (line) => console.log(line),
    sleep,
    run: runCommand,
    timing: DEFAULT_TIMING,
    biliup: "biliup",
    ffmpeg: "ffmpeg",
  };
}

export function nextLocalMidnight(now: number): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime();
}

/** 20111、256000：编辑过于频繁。等一会儿重试刚才这一次，不接着发下一条。 */
async function biliWrite(
  rt: ReleaseRuntime,
  send: () => ReturnType<typeof biliCall>,
): Promise<Awaited<ReturnType<typeof biliCall>>> {
  for (let attempt = 0; ; attempt += 1) {
    const body = await send();
    const busy = body.code === 20111 || body.code === 256000;
    if (!busy || attempt >= 5) return body;
    rt.log(`合集编辑过于频繁（${body.code}），${Math.round(rt.timing.editBusyWaitMs / 1000)} 秒后重试同一次`);
    await rt.sleep(rt.timing.editBusyWaitMs);
  }
}

export async function stampSeason(
  rt: ReleaseRuntime,
  prepareDir: string,
  tracks: ReleaseTrack[],
): Promise<{ seasonId: number; sectionId: number }> {
  const first = tracks[0];
  if (!first) throw new Error(`目录里没有曲目 ${prepareDir}`);
  const cover = ["cover.jpg", "Cover.jpg"].map((name) => path.join(prepareDir, name))
    .find((file) => existsSync(file));
  if (!cover) throw new Error(`备料目录没有专辑封面 ${prepareDir}`);
  const jpeg = path.join(process.cwd(), "tmp", `release-season-${batchKey(prepareDir)}.jpg`);
  const converted = await rt.run([
    rt.ffmpeg, "-y", "-i", cover, "-frames:v", "1", "-q:v", "3", jpeg,
  ]);
  if (converted.exitCode !== 0) throw new Error("封面转 JPEG 失败");
  const form = "application/x-www-form-urlencoded";
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
        const body = await biliWrite(rt, () => biliCall(
          "POST",
          "https://member.bilibili.com/x/vu/web/cover/up",
          new URLSearchParams({
            cover: `data:image/jpeg;base64,${bytes.toString("base64")}`,
            csrf,
          }).toString(),
          form,
        ));
        if (body.code !== 0) throw new Error(`封面上传失败 ${body.code} ${body.message ?? ""}`);
        return String((body.data as { url?: string }).url ?? "");
      },
      create: async (fields) => {
        const { csrf } = await readCookies();
        const body = await biliWrite(rt, () => biliCall(
          "POST",
          "https://member.bilibili.com/x2/creative/web/season/add",
          new URLSearchParams({ ...fields, season_price: "0", csrf }).toString(),
          form,
        ));
        if (body.code !== 0) throw new Error(body.message ?? "创建合集失败");
        return Number(body.data);
      },
      switchGroup: async (seasonId) => {
        const { csrf } = await readCookies();
        const body = await biliWrite(rt, () => biliCall(
          "POST",
          "https://member.bilibili.com/x2/creative/web/season/section/switch",
          new URLSearchParams({
            csrf, season_id: String(seasonId), no_section: "0",
          }).toString(),
          form,
        ));
        // 20081：已存在正片分组，不是限流，也不是失败。
        if (body.code !== 0 && body.code !== 20081) {
          throw new Error(body.message ?? "打开合集分组失败");
        }
      },
      renameSection: async (seasonId, sectionId, title) => {
        const { csrf } = await readCookies();
        const body = await biliWrite(rt, () => biliCall(
          "POST",
          `https://member.bilibili.com/x2/creative/web/season/section/edit?csrf=${csrf}`,
          JSON.stringify({
            section: { id: sectionId, type: 1, seasonId, title },
            sorts: [],
          }),
          "application/json",
        ));
        if (body.code !== 0) throw new Error(body.message ?? "重命名小节失败");
      },
      pause: () => rt.sleep(rt.timing.writeIntervalMs),
    },
  });
  for (const track of tracks) {
    rt.store.patch(releaseItemId(prepareDir, track.index), (item) => {
      item.season_id = season.seasonId;
      item.section_id = season.sectionId;
    });
  }
  rt.log(`合集 ${season.seasonId} 小节 ${season.sectionId}`);
  return season;
}

export async function writeCover(
  rt: ReleaseRuntime,
  track: ReleaseTrack,
  video: string,
  cover: string,
): Promise<void> {
  let seconds = "2";
  if (track.lyricPath && existsSync(track.lyricPath)) {
    const timed = await rt.run([
      "nub", "tmp/lyric-cover-time.ts", track.lyricPath, track.songName, track.artistName,
    ]);
    const line = timed.output.trim().split("\n").at(-1);
    if (timed.exitCode === 0 && line && Number.isFinite(Number(line))) seconds = line;
  }
  const shot = await rt.run([
    rt.ffmpeg, "-y", "-ss", seconds, "-i", video,
    "-frames:v", "1", "-update", "1", "-q:v", "2", cover,
  ]);
  if (shot.exitCode !== 0 || !existsSync(cover)) throw new Error(`抽封面失败 ${track.songName}`);
}

const ANY_UPLOAD = "biliup upload|biliup append|src/release/cli.ts";

/** pattern 默认拦住别的 biliup 投稿和别的 release CLI。runner 自己会起 biliup 子进程，只拦 CLI。 */
export async function assertNoOtherUpload(
  rt: ReleaseRuntime,
  pattern: string = ANY_UPLOAD,
): Promise<void> {
  const found = await rt.run(["pgrep", "-fl", pattern]);
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

export async function saveDraft(
  rt: ReleaseRuntime,
  item: QueueItem,
  output: string,
): Promise<string> {
  const filename = fieldFrom(output, "filename");
  const cid = fieldFrom(output, "cid");
  if (!filename || !cid) throw new Error("投稿输出里没有 filename 和 cid，不重新上传");
  const { csrf } = await readCookies();
  const listed = await biliCall(
    "GET",
    "https://member.bilibili.com/x/vupre/web/draft/list?pn=1&ps=30",
  );
  const count = Array.isArray(listed.data) ? listed.data.length : 0;
  if (rt.timing.draftCapacity - count <= 0) throw new Error("草稿箱已满，剩下的留在队列");
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
  await rt.sleep(rt.timing.writeIntervalMs);
  return String((saved.data as { id?: number } | undefined)?.id ?? saved.data);
}

export async function addToSeason(
  rt: ReleaseRuntime,
  item: QueueItem,
  bvid: string,
): Promise<boolean> {
  if (!item.section_id) return false;
  let waitMs = rt.timing.addDelayMs;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    await rt.sleep(waitMs);
    const result = await rt.run([
      rt.biliup, "-u", cookiePath, "season", "add", String(item.section_id), "--vid", bvid,
    ]);
    const kind = classifySeasonAdd(result.exitCode, result.output);
    rt.log(result.output.slice(-800));
    if (kind === "ok") return true;
    if (kind === "wait-rate") { waitMs = rt.timing.editBusyWaitMs; continue; }
    if (kind === "wait-missing") { waitMs = rt.timing.notFoundWaitMs; continue; }
    return false;
  }
  return false;
}

export async function uploadById(
  rt: ReleaseRuntime,
  id: string,
  uploaded: Set<string> = new Set(),
): Promise<"uploaded" | "skipped"> {
  const queue = rt.store.load();
  const item = queue.items.find((entry) => entry.id === id || entry.video === id);
  if (!item || item.status !== "pending") throw new Error(`找不到待投稿 ${id}`);
  if (uploaded.has(item.video)) return "skipped";
  const result = await uploadItem(item, {
    cookie: cookiePath,
    bin: rt.biliup,
    retryWaitMs: rt.timing.rateLimitWaitMs,
    run: rt.run,
    sleep: rt.sleep,
    saveDraft: async (entry, output) => {
      if (entry.mode === "overwrite") {
        // 覆盖已有稿件不走草稿，草稿不会替换原来的 BV。
        if (/(?<!\d)137022(?!\d)/.test(output)) rt.onHold?.(nextLocalMidnight(Date.now()));
        throw new Error(`覆盖稿遇到投稿过于频繁，不存草稿：${entry.title}`);
      }
      return saveDraft(rt, entry, output);
    },
  });
  uploaded.add(item.video);
  if (result.status === "draft") {
    rt.store.patch(item.id, (current) => {
      current.status = "draft";
      current.draft_id = result.draftId;
    });
    throw new Error(`投稿过于频繁，已从 ${item.title} 停止`);
  }
  if (item.mode === "overwrite" && item.bvid) {
    try {
      await trimNewPart(item.bvid, item.title, item.upload.hires);
    } catch (error) {
      rt.log(error instanceof Error ? error.message : String(error));
    }
  }
  const current = rt.store.patch(item.id, (entry) => {
    entry.status = "done";
    entry.bvid = result.bvid;
    entry.finished = new Date().toISOString();
    entry.season_added = false;
  });
  if (!current) return "uploaded";
  const added = await addToSeason(rt, current, result.bvid);
  rt.store.patch(item.id, (entry) => { entry.season_added = added; });
  rt.log(`投稿完成 ${current.title} ${result.bvid}`);
  return "uploaded";
}
