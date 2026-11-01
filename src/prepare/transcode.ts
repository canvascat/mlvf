import { parseFile } from "music-metadata";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

function remotionBin(): string {
  return path.join(process.cwd(), "node_modules", ".bin", "remotion");
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} 失败（退出码 ${code}）\n${stderr.trim()}`));
    });
  });
}

async function runFfmpeg(args: string[]): Promise<void> {
  try {
    await run("ffmpeg", args);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await run(remotionBin(), ["ffmpeg", ...args]);
      return;
    }
    throw error;
  }
}

/**
 * Chromium 的 WebCodecs 没有 ALAC 解码器，Studio 预览、背景低频分析和渲染都读不了。
 * ALAC 到 FLAC 是无损转换，采样率和位深不变。
 */
export async function isAlac(audioPath: string): Promise<boolean> {
  if (![".m4a", ".mp4", ".alac"].includes(path.extname(audioPath).toLowerCase())) {
    return false;
  }
  try {
    const { format } = await parseFile(audioPath, { duration: false });
    return /alac|apple lossless/i.test(
      `${format.codec ?? ""} ${format.codecProfile ?? ""}`,
    );
  } catch {
    return false;
  }
}

/** 转成同目录同名 .flac，保留标签和封面。ALAC 副本留在原处，不删。 */
export async function transcodeAlacToFlac(audioPath: string): Promise<string> {
  const flacPath = path.join(
    path.dirname(audioPath),
    `${path.basename(audioPath, path.extname(audioPath))}.flac`,
  );
  if (existsSync(flacPath)) {
    await rm(flacPath);
  }
  await runFfmpeg([
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    audioPath,
    "-map",
    "0",
    "-map_metadata",
    "0",
    "-c:a",
    "flac",
    "-sample_fmt",
    "s32",
    "-c:v",
    "copy",
    flacPath,
  ]);
  return flacPath;
}
