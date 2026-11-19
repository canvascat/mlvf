import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { parseFile } from "music-metadata";
import { emptyQueue, type QueueFile } from "./queue";
import type { SeasonRecord } from "./season";

export const queuePath = path.join(process.cwd(), "tmp/upload-queue.json");
export const cookiePath = path.join(homedir(), ".config/biliup/cookies.json");

export function runCommand(command: string[]): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0] ?? "", command.slice(1), {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ exitCode: code ?? 1, output }));
  });
}

export async function loadQueue(): Promise<QueueFile> {
  try {
    return JSON.parse(await readFile(queuePath, "utf8")) as QueueFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyQueue();
    throw error;
  }
}

export async function saveQueue(queue: QueueFile): Promise<void> {
  await writeFile(queuePath, JSON.stringify(queue, null, 2) + "\n");
}

export async function readCookies(): Promise<{ jar: string; csrf: string }> {
  const data = JSON.parse(await readFile(cookiePath, "utf8")) as {
    cookie_info: { cookies: { name: string; value: string }[] };
  };
  const cookies = data.cookie_info.cookies;
  const csrf = cookies.find((cookie) => cookie.name === "bili_jct")?.value;
  if (!csrf) throw new Error("登录态里没有 bili_jct");
  return {
    jar: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
    csrf,
  };
}

export async function biliCall(method: string, url: string, body?: string, contentType?: string) {
  const { jar } = await readCookies();
  const response = await fetch(url, {
    method,
    headers: {
      Cookie: jar,
      "User-Agent": "Mozilla/5.0",
      Referer: "https://member.bilibili.com/",
      ...(contentType ? { "Content-Type": contentType } : {}),
    },
    body,
  });
  return await response.json() as { code?: number; message?: string; data?: unknown };
}

export async function probeAudio(audio: string) {
  const metadata = await parseFile(audio);
  const codec = metadata.format.codec?.toLowerCase() ?? "";
  const lossless = metadata.format.lossless === true
    || ["flac", "alac", "wav", "pcm"].some((name) => codec.includes(name));
  return {
    lossless,
    sampleRate: metadata.format.sampleRate ?? 0,
    bitsPerSample: metadata.format.bitsPerSample ?? 0,
  };
}

export async function readTrackNumber(audio: string): Promise<number | null> {
  const metadata = await parseFile(audio);
  return metadata.common.track?.no ?? null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

type RawSeason = {
  season?: { id?: number; title?: string; no_section?: number };
  sections?: { sections?: { id?: number; title?: string }[] } | { id?: number; title?: string }[];
};

const STUDIO_KEYS = [
  "copyright", "source", "tid", "cover", "title", "desc_format_id", "desc", "desc_v2",
  "dynamic", "tag", "interactive", "no_reprint", "charging_pay", "aid",
  "is_only_self", "mission_id", "dtime",
];

export async function trimNewPart(bvid: string, fallbackTitle: string, hires: 0 | 1): Promise<void> {
  const shown = await runCommand(["biliup", "-u", cookiePath, "show", bvid]);
  const start = shown.output.indexOf("{");
  if (shown.exitCode !== 0 || start < 0) throw new Error(`读取稿件失败 ${bvid}`);
  const data = JSON.parse(shown.output.slice(start)) as {
    archive?: Record<string, unknown>;
    videos?: { filename: string; title?: string; desc?: string; cid: number; ctime?: number }[];
  };
  const videos = data.videos ?? [];
  if (videos.length < 2) return;
  const ordered = [...videos].sort((a, b) => (a.ctime ?? 0) - (b.ctime ?? 0));
  const oldest = ordered[0];
  const newest = ordered.at(-1);
  if (!oldest || !newest) return;
  const payload: Record<string, unknown> = {};
  for (const key of STUDIO_KEYS) {
    if (data.archive?.[key] != null) payload[key] = data.archive[key];
  }
  payload.videos = [{
    filename: newest.filename,
    title: oldest.title || fallbackTitle,
    desc: newest.desc || "",
    cid: newest.cid,
  }];
  payload.dolby = 0;
  payload.lossless_music = hires;
  payload.up_selection_reply = false;
  payload.up_close_reply = false;
  payload.up_close_danmu = false;
  const { csrf } = await readCookies();
  const edited = await biliCall(
    "POST",
    `https://member.bilibili.com/x/vu/web/edit?csrf=${csrf}`,
    JSON.stringify(payload),
    "application/json",
  );
  if (edited.code !== 0) throw new Error(`编辑稿件失败 ${edited.code} ${edited.message ?? ""}`);
}

export async function listSeasons(): Promise<SeasonRecord[]> {
  const found: SeasonRecord[] = [];
  for (let page = 1; page <= 8; page += 1) {
    const body = await biliCall(
      "GET",
      `https://member.bilibili.com/x2/creative/web/seasons?pn=${page}&ps=20&order=mtime&sort=desc&draft=1`,
    );
    if (body.code !== 0) throw new Error(`列出合集失败 ${body.code} ${body.message ?? ""}`);
    const seasons = ((body.data as { seasons?: RawSeason[] } | undefined)?.seasons) ?? [];
    for (const item of seasons) {
      const sections = Array.isArray(item.sections)
        ? item.sections
        : item.sections?.sections ?? [];
      found.push({
        id: Number(item.season?.id),
        title: item.season?.title ?? "",
        noSection: Number(item.season?.no_section ?? 0),
        sections: sections.map((section) => ({
          id: Number(section.id),
          title: section.title ?? "",
        })),
      });
    }
    if (seasons.length < 20) break;
  }
  return found;
}
