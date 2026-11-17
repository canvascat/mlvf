import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { delay } from "./studio-browser";

const execFileAsync = promisify(execFile);

const DEFAULT_STUDIO_PORTS = [3000, 3333];

function projectRoot(): string {
  return process.cwd();
}

function remotionEntryMarker(): string {
  return path.join("src", "index.ts");
}

export function isRemotionStudioCommand(command: string, root: string): boolean {
  const normalized = command.toLowerCase();
  if (!normalized.includes("remotion") || !normalized.includes("studio")) {
    return false;
  }
  const rootToken = root.toLowerCase();
  return (
    command.includes(root) ||
    normalized.includes(rootToken) ||
    command.includes(path.join(root, remotionEntryMarker()))
  );
}

export function isAlbumPreviewCommand(command: string, root: string): boolean {
  return (
    command.includes("album-preview") &&
  (command.includes(root) || command.includes("src/export/album-preview"))
  );
}

function isStudioListenerCommand(command: string): boolean {
  const normalized = command.toLowerCase();
  return (
    normalized.includes("remotion") ||
    normalized.includes("@remotion") ||
    normalized.includes("vite") ||
    normalized.includes("webpack")
  );
}

async function commandForPid(pid: number): Promise<string> {
  if (process.platform === "win32") {
    return "";
  }
  try {
    const { stdout } = await execFileAsync("ps", [
      "-p",
      String(pid),
      "-o",
      "command=",
    ]);
    return stdout.trim();
  } catch {
    return "";
  }
}

async function pidsFromPgrep(patterns: string[]): Promise<number[]> {
  if (process.platform === "win32") {
    return [];
  }
  const found = new Set<number>();
  for (const pattern of patterns) {
    try {
      const { stdout } = await execFileAsync("pgrep", ["-if", pattern]);
      for (const line of stdout.trim().split("\n")) {
        const pid = Number.parseInt(line, 10);
        if (Number.isFinite(pid) && pid > 1) {
          found.add(pid);
        }
      }
    } catch {
      // pgrep 无匹配时退出 1
    }
  }
  return [...found];
}

async function listenPidsOnPort(port: number): Promise<number[]> {
  if (process.platform === "win32") {
    return [];
  }
  try {
    const { stdout } = await execFileAsync("lsof", [
      "-nP",
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
      "-t",
    ]);
    return stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => Number.parseInt(line, 10))
      .filter((pid) => Number.isFinite(pid) && pid > 1);
  } catch {
    return [];
  }
}

async function collectStudioPids(options: {
  root: string;
  ports: number[];
}): Promise<number[]> {
  const { root, ports } = options;
  const candidates = new Set<number>();

  for (const pattern of [
    "remotion studio",
    "src/index.ts",
    "export/album-preview",
    "album-preview.ts",
  ]) {
    for (const pid of await pidsFromPgrep([pattern])) {
      candidates.add(pid);
    }
  }

  for (const port of ports) {
    for (const pid of await listenPidsOnPort(port)) {
      candidates.add(pid);
    }
  }

  const matched = new Set<number>();
  for (const pid of candidates) {
    if (pid === process.pid || pid === process.ppid) {
      continue;
    }
    const command = await commandForPid(pid);
    if (!command) {
      continue;
    }
    if (
      isRemotionStudioCommand(command, root) ||
      isAlbumPreviewCommand(command, root) ||
      (ports.some((port) => command.includes(String(port))) &&
        isStudioListenerCommand(command))
    ) {
      matched.add(pid);
    }
  }

  return [...matched];
}

async function terminatePids(pids: number[]): Promise<void> {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // 可能已退出
    }
  }
  if (pids.length === 0) {
    return;
  }
  await delay(1200);
  for (const pid of pids) {
    try {
      process.kill(pid, 0);
      process.kill(pid, "SIGKILL");
    } catch {
      // 已退出
    }
  }
}

/** 关掉可能占用浏览器或端口的 Studio / album-preview，避免 render 时 Target closed。 */
export async function stopRemotionStudioBeforeExport(options?: {
  ports?: number[];
  quiet?: boolean;
}): Promise<number> {
  const root = projectRoot();
  const ports = options?.ports ?? DEFAULT_STUDIO_PORTS;
  const pids = await collectStudioPids({ root, ports });
  if (pids.length === 0) {
    return 0;
  }

  if (!options?.quiet) {
    console.log(
      `正在关闭 Remotion Studio / 专辑预览（${pids.length} 个进程）…`,
    );
  }
  await terminatePids(pids);
  await delay(400);
  return pids.length;
}