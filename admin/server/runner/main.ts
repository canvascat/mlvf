import { runCommand } from "../../../src/release/io";
import { listDraftIds } from "../bili";
import { bootDb } from "../boot";
import { createIdleHook } from "../idle-scheduler";
import { recoverInterrupted } from "../jobs";
import { executors } from "./executors";
import { parseScreenLocked } from "./idle";
import { createRunner } from "./index";
import { HEARTBEAT_MS, acquireRunnerLock, beat, releaseRunnerLock } from "./lock";

const db = bootDb();
const pid = process.pid;

if (!acquireRunnerLock(db, pid, Date.now())) {
  console.error("已有 runner 在运行，退出");
  process.exit(1);
}
const recovered = recoverInterrupted(db, Date.now());
if (recovered > 0) console.log(`上次退出时有 ${recovered} 个任务还在运行，已标为中断，可在界面里重试`);

const idle = createIdleHook(db, {
  now: Date.now,
  screenLocked: async () => parseScreenLocked((await runCommand(["ioreg", "-n", "Root", "-d1"])).output),
  listDraftIds,
});
const runner = createRunner({ db, executors, onTick: idle });
const heartbeat = setInterval(() => beat(db, pid, Date.now()), HEARTBEAT_MS);
runner.start();
console.log(`runner 已启动 pid=${pid}`);

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  clearInterval(heartbeat);
  console.log("runner 正在停止，在跑的任务会标为中断…");
  await runner.stop();
  releaseRunnerLock(db, pid);
  process.exit(0);
}
process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
