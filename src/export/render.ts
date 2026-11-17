import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AlbumCompositionProps } from "../helpers/schema";
import { trackPlayableSeconds } from "../helpers/track-duration";
import { applyProjectTmp, withProjectTmpEnv } from "../lib/project-tmp";
import {
  ALBUM_COMPOSITION_ID,
  COMPOSITION_ID,
  PLAYLIST_COMPOSITION_ID,
  SPECTRA_COMPOSITION_ID,
} from "../remotion/constants";
import { ensureOutputDir, prepareExportJob, type ExportJob } from "./assets";
import {
  albumChaptersFromTracks,
  buildChapterSidecar,
} from "./chapters";
import {
  concatAudioToFlac,
  extractVideoFrames,
  holdStillsToVideo,
  muxOriginalAudio,
  type CueStill,
} from "./mux";
import type { ExportArgs } from "./parse-args";
import { writeStudioPreviewOverride } from "./studio-preview-file";
import type { StudioPreviewOverride } from "../helpers/studio-preview";
import { stopRemotionStudioBeforeExport } from "./studio-guard";

function resolveBrowserExecutable(): string | undefined {
  if (process.env.REMOTION_BROWSER_EXECUTABLE) {
    return process.env.REMOTION_BROWSER_EXECUTABLE;
  }
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function projectRoot(): string {
  return process.cwd();
}

function remotionEntry(): string {
  return path.join(projectRoot(), "src/index.ts");
}

function remotionBin(): string {
  return path.join(projectRoot(), "node_modules", ".bin", "remotion");
}

function runRemotion(args: string[], tmpDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(remotionBin(), args, {
      stdio: "inherit",
      cwd: projectRoot(),
      env: withProjectTmpEnv(tmpDir),
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0 || code === null) {
        resolve();
        return;
      }
      reject(new Error(`Remotion 退出码 ${code}`));
    });
  });
}

function remotionCommonArgs(options: {
  job: ExportJob;
  args: ExportArgs;
  outputPath: string;
  compositionId: string;
  propsPath: string;
}): string[] {
  const { job, args, outputPath, compositionId, propsPath } = options;
  const remotionArgs = [
    "render",
    remotionEntry(),
    compositionId,
    outputPath,
    `--props=${propsPath}`,
    ...(job.ownsPublicDir ? [`--public-dir=${job.publicDir}`] : []),
    "--muted",
    "--codec=h264",
    `--concurrency=${args.concurrency}`,
    "--gl=angle",
    "--chrome-mode=headless-shell",
    `--fps=${job.fps}`,
    "--timeout=120000",
  ];
  if (args.frames) {
    remotionArgs.push(`--frames=${args.frames}`);
  }
  const browserExecutable = resolveBrowserExecutable();
  if (browserExecutable) {
    remotionArgs.push(`--browser-executable=${browserExecutable}`);
  }
  return remotionArgs;
}

function singleCompositionId(args: ExportArgs): string {
  if (args.playlist) return PLAYLIST_COMPOSITION_ID;
  if (args.album) return ALBUM_COMPOSITION_ID;
  if (args.spectra) return SPECTRA_COMPOSITION_ID;
  return COMPOSITION_ID;
}

export async function previewStudio(args: ExportArgs): Promise<void> {
  const tmpDir = await applyProjectTmp();
  if (!args.config) {
    await writeStudioPreviewOverride(null);
    console.log("正在启动 Remotion Studio 预览默认曲目");
    await runRemotion(["studio", remotionEntry()], tmpDir);
    return;
  }

  const job = await prepareExportJob(args);
  const compositionId = singleCompositionId(args);
  const studioOverride = {
    compositionId,
    props: job.inputProps,
  } as StudioPreviewOverride;
  await writeStudioPreviewOverride(studioOverride);

  console.log(`正在启动 Remotion Studio 预览：《${job.title}》`);
  console.log(
    `Studio 默认先打开第一个画面，请在左侧选择 ${compositionId}（或直接访问 /${compositionId}）`,
  );
  console.log("预览参数已写入 defaultProps，右侧面板可查看与编辑");

  try {
    await runRemotion(
      [
        "studio",
        remotionEntry(),
        ...(job.ownsPublicDir ? [`--public-dir=${job.publicDir}`] : []),
      ],
      tmpDir,
    );
  } finally {
    if (job.ownsPublicDir) {
      await rm(job.publicDir, { recursive: true, force: true });
    }
  }
}

function albumInputProps(job: ExportJob): AlbumCompositionProps {
  if (!("tracks" in job.inputProps) || !("audioFileUrl" in job.inputProps)) {
    throw new Error("专辑导出需要曲目列表");
  }
  return job.inputProps;
}

function trackLabel(job: ExportJob): string {
  return job.sourceAudios.length > 1
    ? `${job.title} 等 ${job.sourceAudios.length} 首`
    : job.title;
}

async function renderAlbumCueVideo(options: {
  job: ExportJob;
  args: ExportArgs;
  workDir: string;
  silentVideoPath: string;
  tmpDir: string;
}): Promise<void> {
  const { job, args, workDir, silentVideoPath, tmpDir } = options;
  const tracks = albumInputProps(job).tracks;
  const cuesVideoPath = path.join(workDir, "cues.mp4");
  const stillsDir = path.join(workDir, "stills");
  const propsPath = path.join(workDir, "input-props.json");
  await mkdir(stillsDir, { recursive: true });
  await writeFile(
    propsPath,
    JSON.stringify({ ...albumInputProps(job), cueStills: true }),
  );

  console.log(
    `正在渲染专辑静帧：《${trackLabel(job)}》（${tracks.length} 帧，AlbumPlayer）`,
  );
  await runRemotion(
    remotionCommonArgs({
      job,
      args: { ...args, frames: undefined },
      outputPath: cuesVideoPath,
      compositionId: ALBUM_COMPOSITION_ID,
      propsPath,
    }),
    tmpDir,
  );

  await extractVideoFrames(cuesVideoPath, path.join(stillsDir, "cue-%02d.png"));
  const files = (await readdir(stillsDir))
    .filter((name) => name.endsWith(".png"))
    .sort();
  if (files.length !== tracks.length) {
    throw new Error(
      `专辑静帧数量不对: 渲了 ${files.length} 张，曲目 ${tracks.length} 首`,
    );
  }

  const stills: CueStill[] = files.map((file, index) => {
    const track = tracks[index];
    if (!track) {
      throw new Error(`缺少曲目 ${index}`);
    }
    return {
      path: path.join(stillsDir, file),
      durationSeconds: Math.max(
        0.001,
        trackPlayableSeconds(
          track.audioEndInSeconds ?? 0,
          track.audioOffsetInSeconds,
          track.audioEndInSeconds,
        ),
      ),
    };
  });

  console.log("正在按曲目时长铺开静帧…");
  await holdStillsToVideo(stills, silentVideoPath, job.fps);
}

async function writeAlbumChapterSidecar(
  job: ExportJob,
  outputLocation: string,
): Promise<void> {
  const chapters = albumChaptersFromTracks(albumInputProps(job).tracks);
  const sidecarPath = path.join(
    path.dirname(outputLocation),
    `${path.basename(outputLocation, path.extname(outputLocation))}.chapters.txt`,
  );
  await writeFile(sidecarPath, buildChapterSidecar(chapters));
  console.log(`已写出章节 ${sidecarPath}`);
}

export async function exportVideo(args: ExportArgs): Promise<string> {
  await stopRemotionStudioBeforeExport();
  const tmpDir = await applyProjectTmp();
  const job = await prepareExportJob(args);
  const outputLocation = path.resolve(job.outputPath);
  await ensureOutputDir(outputLocation);
  const workDir = await mkdtemp(path.join(tmpDir, "rmv-render-"));
  const silentVideoPath = path.join(workDir, "video-only.mp4");
  const propsPath = path.join(workDir, "input-props.json");
  const useAlbumStills = Boolean(args.album) && !args.frames;
  const compositionId = singleCompositionId(args);

  try {
    if (useAlbumStills) {
      await renderAlbumCueVideo({
        job,
        args,
        workDir,
        silentVideoPath,
        tmpDir,
      });
    } else {
      await writeFile(propsPath, JSON.stringify(job.inputProps));
      console.log(
        `正在渲染无声画面：《${trackLabel(job)}》（${job.durationInFrames} 帧，${compositionId}，concurrency=${args.concurrency}）`,
      );
      await runRemotion(
        remotionCommonArgs({
          job,
          args,
          outputPath: silentVideoPath,
          compositionId,
          propsPath,
        }),
        tmpDir,
      );
    }

    let audio = job.sourceAudios[0];
    if (!audio) {
      throw new Error("没有可合成的音轨");
    }
    if (job.sourceAudios.length > 1) {
      console.log("正在拼接原音轨…");
      const playlistPath = path.join(workDir, "playlist.flac");
      await concatAudioToFlac(job.sourceAudios, playlistPath);
      audio = {
        path: playlistPath,
        offsetInSeconds: 0,
        durationInSeconds: 0,
      };
    }

    console.log(
      job.sourceAudios.length > 1
        ? "正在合成拼接后的音轨…"
        : "正在无损合成原音轨…",
    );
    await muxOriginalAudio(silentVideoPath, audio, outputLocation);

    if (args.album) {
      await writeAlbumChapterSidecar(job, outputLocation);
    }
  } finally {
    if (job.ownsPublicDir) {
      await rm(job.publicDir, { recursive: true, force: true });
    }
    await rm(workDir, { recursive: true, force: true });
  }

  return outputLocation;
}
