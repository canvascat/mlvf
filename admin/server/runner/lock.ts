import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { runnerState } from "../db/schema";

export const HEARTBEAT_MS = 5000;
const STALE_MS = 15_000;

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** 已有活着的 runner（心跳新鲜且进程存在）时返回 false。 */
export function acquireRunnerLock(db: Db, pid: number, now: number): boolean {
  return db.transaction((tx) => {
    const state = tx.select().from(runnerState).where(eq(runnerState.id, 1)).get();
    const other = state?.pid != null && state.pid !== pid
      && state.heartbeatAt != null && now - state.heartbeatAt < STALE_MS && alive(state.pid);
    if (other) return false;
    tx.update(runnerState).set({ pid, heartbeatAt: now }).where(eq(runnerState.id, 1)).run();
    return true;
  });
}

export function beat(db: Db, pid: number, now: number): void {
  db.update(runnerState).set({ pid, heartbeatAt: now }).where(eq(runnerState.id, 1)).run();
}

export function releaseRunnerLock(db: Db, pid: number): void {
  const state = db.select().from(runnerState).where(eq(runnerState.id, 1)).get();
  if (state?.pid === pid) db.update(runnerState).set({ pid: null, heartbeatAt: null }).where(eq(runnerState.id, 1)).run();
}

export function runnerOnline(heartbeatAt: number | null, now: number): boolean {
  return heartbeatAt != null && now - heartbeatAt < STALE_MS;
}
