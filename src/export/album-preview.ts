import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { COMPOSITION_ID, DEFAULT_FPS, SPECTRA_COMPOSITION_ID } from "../remotion/constants";
import { applyProjectTmp, withProjectTmpEnv } from "../lib/project-tmp";
import { prepareSingleTrackExportJob } from "./assets";
import type { ExportArgs } from "./parse-args";
import { writeStudioPreviewOverride } from "./studio-preview-file";
import type { StudioPreviewOverride } from "../helpers/studio-preview";
import { delay, refreshStudioBrowser, studioPageUrl } from "./studio-browser";

const USAGE = `用法: nub run album-preview -- <预处理目录> [选项]

在一张专辑的备料目录里切换单曲，Remotion Studio 保持打开。切歌会重写预览 props 并刷新 public 素材。

快捷键（焦点在本终端）:
  j / n / →     下一首
  k / p / ←     上一首
  r / Enter     刷新当前首
  1-9           跳到第 n 首
  q / Ctrl+C    退出（并结束本次启动的 Studio）

选项:
  --spectra     用 SpectraPlayer
  --background  slow | static | normal
  --no-studio   只切换预览文件，不启动 Studio（需自行用相同 public-dir 打开 Studio）
  --no-browser  不自动打开或刷新浏览器
  --port        Studio 端口，默认 3333
`;

function projectRoot(): string {
  return process.cwd();
}

function remotionBin(): string {
  return path.join(projectRoot(), "node_modules", ".bin", "remotion");
}

function remotionEntry(): string {
  return path.join(projectRoot(), "src/index.ts");
}

function compositionId(spectra: boolean): string {
  return spectra ? SPECTRA_COMPOSITION_ID : COMPOSITION_ID;
}

async function listTrackConfigs(dir: string): Promise<string[]> {
  const abs = path.resolve(dir);
  const entries = await readdir(abs, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(abs, entry.name));
  return files.sort((a, b) =>
    path.basename(a).localeCompare(path.basename(b), "zh-Hans"),
  );
}

async function clearPublicDir(publicDir: string): Promise<void> {
  await mkdir(publicDir, { recursive: true });
  const entries = await readdir(publicDir, { withFileTypes: true });
  await Promise.all(
    entries.map((entry) =>
      rm(path.join(publicDir, entry.name), { recursive: true, force: true }),
    ),
  );
}

function bustPreviewMediaUrls<T extends Record<string, unknown>>(
  props: T,
  token: number,
): T {
  const bust = (url: unknown) => {
    if (typeof url !== "string" || !url) {
      return url;
    }
    return url.includes("?") ? `${url}&rmv=${token}` : `${url}?rmv=${token}`;
  };
  return {
    ...props,
    audioFileUrl: bust(props.audioFileUrl),
    lyricsFileUrl: bust(props.lyricsFileUrl),
    coverImageUrl: bust(props.coverImageUrl),
  };
}

async function applyTrackPreview(
  configPath: string,
  publicDir: string,
  baseArgs: ExportArgs,
): Promise<string> {
  await clearPublicDir(publicDir);
  const job = await prepareSingleTrackExportJob(
    { ...baseArgs, config: configPath },
    publicDir,
  );
  const composition = compositionId(Boolean(baseArgs.spectra));
  const token = Date.now();
  const override: StudioPreviewOverride = {
    compositionId: composition,
    props: bustPreviewMediaUrls(
      job.inputProps as Record<string, unknown>,
      token,
    ),
  } as StudioPreviewOverride;
  await writeStudioPreviewOverride(override);
  return job.title;
}

function startStudio(options: {
  publicDir: string;
  tmpDir: string;
  port: number;
}): ChildProcess {
  const child = spawn(
    remotionBin(),
    [
      "studio",
      remotionEntry(),
      `--public-dir=${options.publicDir}`,
      `--port=${options.port}`,
    ],
    {
      cwd: projectRoot(),
      env: withProjectTmpEnv(options.tmpDir),
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    },
  );
  return child;
}

function printHelp(): void {
  console.log(USAGE);
}

function cliArgv(argv: string[]): string[] {
  if (argv[0] === "--") {
    return argv.slice(1);
  }
  return argv;
}

function parseCli(argv: string[]): {
  dir: string;
  spectra: boolean;
  background?: ExportArgs["background"];
  noStudio: boolean;
  noBrowser: boolean;
  port: number;
} {
  if (argv.includes("-h") || argv.includes("--help")) {
    printHelp();
    process.exit(0);
  }
  let dir = "";
  let spectra = false;
  let background: ExportArgs["background"] | undefined;
  let noStudio = false;
  let noBrowser = false;
  let port = 3333;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--spectra") {
      spectra = true;
      continue;
    }
    if (arg === "--no-studio") {
      noStudio = true;
      continue;
    }
    if (arg === "--no-browser") {
      noBrowser = true;
      continue;
    }
    if (arg === "--background") {
      const value = argv[++i];
      if (!value) {
        throw new Error("--background 需要参数");
      }
      background = value as ExportArgs["background"];
      continue;
    }
    if (arg === "--port") {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("--port 需要正整数");
      }
      port = value;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`未知选项: ${arg}\n\n${USAGE}`);
    }
    if (!dir) {
      dir = arg;
    }
  }
  if (!dir) {
    throw new Error(`缺少预处理目录\n\n${USAGE}`);
  }
  return { dir, spectra, background, noStudio, noBrowser, port };
}

function renderStatus(options: {
  configs: string[];
  index: number;
  title: string;
  composition: string;
  studioUrl: string;
  publicDir: string;
}): void {
  console.clear();
  console.log("专辑预览 · 快捷键: j/k 切歌 · r 刷新 · 1-9 跳转 · q 退出");
  console.log(`Studio: ${options.studioUrl}  →  Composition: ${options.composition}`);
  console.log(`public: ${options.publicDir}`);
  console.log("");
  for (const [i, config] of options.configs.entries()) {
    const mark = i === options.index ? "▸" : " ";
    console.log(`${mark} ${String(i + 1).padStart(2)}  ${path.basename(config, ".json")}`);
  }
  console.log("");
  console.log(`当前: ${options.title}`);
}

async function main(): Promise<void> {
  const { dir, spectra, background, noStudio, noBrowser, port } = parseCli(
    cliArgv(process.argv.slice(2)),
  );
  const configs = await listTrackConfigs(dir);
  if (configs.length === 0) {
    throw new Error(`目录里没有 .json: ${path.resolve(dir)}`);
  }

  const tmpDir = await applyProjectTmp();
  const sessionDir = path.join(tmpDir, "rmv-album-preview");
  const publicDir = path.join(sessionDir, "public");
  await mkdir(publicDir, { recursive: true });

  const baseArgs: ExportArgs = {
    fps: DEFAULT_FPS,
    concurrency: "1",
    spectra,
    background,
  };

  let index = 0;
  let title = await applyTrackPreview(configs[index]!, publicDir, baseArgs);
  const comp = compositionId(spectra);

  let studioBrowserPrimed = false;

  async function syncBrowser(allowOpen: boolean): Promise<boolean> {
    if (noStudio || noBrowser) {
      return false;
    }
    const ok = await refreshStudioBrowser(port, comp, { allowOpen });
    if (ok) {
      studioBrowserPrimed = true;
    }
    return ok;
  }

  let studioChild: ChildProcess | null = null;
  if (!noStudio) {
    if (!existsSync(remotionBin())) {
      throw new Error("找不到 remotion，请先 nub install");
    }
    studioChild = startStudio({ publicDir, tmpDir, port });
    studioChild.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      if (text.includes("http")) {
        process.stdout.write(text);
      }
    });
    studioChild.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      if (/https?:\/\//.test(text) || text.toLowerCase().includes("studio")) {
        process.stderr.write(text);
      }
    });
  }

  const pageUrl = studioPageUrl(port, comp);
  if (!noStudio) {
    console.log(`正在启动 Studio（composition: ${comp}）`);
    console.log(`预览页: ${pageUrl}`);
    if (!noBrowser) {
      void delay(3500).then(() =>
        syncBrowser(!studioBrowserPrimed),
      );
    }
  } else {
    console.log(`已写入预览。请自行: remotion studio --public-dir=${publicDir}`);
  }

  const bump = async (next: number) => {
    index = ((next % configs.length) + configs.length) % configs.length;
    title = await applyTrackPreview(configs[index]!, publicDir, baseArgs);
    await delay(120);
    const reloaded = await syncBrowser(false);
    renderStatus({
      configs,
      index,
      title,
      composition: comp,
      studioUrl: pageUrl,
      publicDir,
    });
    if (!noStudio && !reloaded && !noBrowser) {
      console.log("未能自动刷新浏览器，请在该 tab 按 ⌘R");
    }
  };

  renderStatus({
    configs,
    index,
    title,
    composition: comp,
    studioUrl: pageUrl,
    publicDir,
  });

  if (!process.stdin.isTTY) {
    console.log("非交互终端，只加载第 1 首。若要切歌请在本机终端运行此命令。");
    return;
  }

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  const shutdown = () => {
    process.stdin.setRawMode(false);
    if (studioChild && !studioChild.killed) {
      studioChild.kill("SIGTERM");
    }
    process.exit(0);
  };

  process.stdin.on("keypress", (str, key) => {
    if (!key) {
      return;
    }
    if (key.ctrl && key.name === "c") {
      shutdown();
      return;
    }
    if (str === "q") {
      shutdown();
      return;
    }
    if (str === "j" || str === "n" || key.name === "right") {
      void bump(index + 1);
      return;
    }
    if (str === "k" || str === "p" || key.name === "left") {
      void bump(index - 1);
      return;
    }
    if (str === "r" || key.name === "return") {
      void bump(index);
      return;
    }
    if (/^[1-9]$/.test(str)) {
      const target = Number(str) - 1;
      if (target < configs.length) {
        void bump(target);
      }
    }
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});