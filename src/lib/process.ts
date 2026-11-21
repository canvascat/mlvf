import { spawn } from "node:child_process";

export type StreamOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  /** 每一行（按 \n 或 \r 切）。 */
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
};

export type StreamResult = { exitCode: number; output: string; aborted: boolean };

/** 运行子进程并逐行回调。不使用 detached：终端关闭时子进程跟着退出。 */
export function streamCommand(command: string[], options: StreamOptions = {}): Promise<StreamResult> {
  return new Promise((resolve, reject) => {
    const [bin, ...args] = command;
    if (!bin) { reject(new Error("命令为空")); return; }
    const child = spawn(bin, args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let aborted = false;
    const tails = { stdout: "", stderr: "" };
    const feed = (stream: "stdout" | "stderr", chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      const pieces = (tails[stream] + text).split(/[\r\n]+/);
      tails[stream] = pieces.pop() ?? "";
      for (const line of pieces) if (line) options.onLine?.(line, stream);
    };
    child.stdout.on("data", (chunk: Buffer) => feed("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => feed("stderr", chunk));
    let killer: NodeJS.Timeout | undefined;
    const onAbort = () => {
      aborted = true;
      child.kill("SIGTERM");
      killer = setTimeout(() => child.kill("SIGKILL"), 5000);
    };
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", reject);
    child.on("close", (code) => {
      if (killer) clearTimeout(killer);
      options.signal?.removeEventListener("abort", onAbort);
      for (const stream of ["stdout", "stderr"] as const) {
        if (tails[stream]) options.onLine?.(tails[stream], stream);
      }
      resolve({ exitCode: code ?? 1, output, aborted });
    });
  });
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("已取消")); return; }
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(new Error("已取消")); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
