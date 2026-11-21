import { spawn, type ChildProcess } from "node:child_process";
import { bootDb } from "./server/boot";

// 先在这里迁移并导入旧队列，两个子进程启动时就不会抢着建表。
bootDb();

const children = new Map<string, ChildProcess>();
let closing = false;
let exitCode = 0;

function pipe(name: string, stream: NodeJS.ReadableStream, out: NodeJS.WriteStream): void {
  let tail = "";
  stream.on("data", (chunk: Buffer) => {
    const lines = (tail + chunk.toString()).split("\n");
    tail = lines.pop() ?? "";
    for (const line of lines) out.write(`[${name}] ${line}\n`);
  });
  stream.on("end", () => { if (tail) out.write(`[${name}] ${tail}\n`); });
}

function shutdown(code: number): void {
  if (closing) return;
  closing = true;
  exitCode = code;
  for (const child of children.values()) child.kill("SIGTERM");
  setTimeout(() => {
    for (const child of children.values()) child.kill("SIGKILL");
    process.exit(exitCode);
  }, 10_000).unref();
  if (children.size === 0) process.exit(exitCode);
}

function start(name: string, command: string, args: string[]): void {
  // 不用 detached：终端关闭时子进程跟着退出。
  const child = spawn(command, args, { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  children.set(name, child);
  pipe(name, child.stdout, process.stdout);
  pipe(name, child.stderr, process.stderr);
  child.on("exit", (code) => {
    children.delete(name);
    console.log(`[${name}] 已退出 (${code ?? "signal"})`);
    shutdown(code ?? 1);
    if (closing && children.size === 0) process.exit(exitCode);
  });
}

start("runner", "nub", ["admin/server/runner/main.ts"]);
start("web", "nub", ["exec", "vite", "dev"]);
console.log("管理后台 http://127.0.0.1:3100 （Ctrl-C 停止，在跑的任务会标为中断）");

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
