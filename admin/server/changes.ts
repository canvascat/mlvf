import { asc, gte } from "drizzle-orm";
import { abortableSleep } from "../../src/lib/process";
import type { Db } from "./db/client";
import { jobs, type JobRow } from "./db/schema";
import { listLogs } from "./jobs";

const nap = (ms: number, signal: AbortSignal) => abortableSleep(ms, signal).catch(() => undefined);

export async function* pollJobChanges(
  db: Db,
  signal: AbortSignal,
  options: { since?: number; pollMs?: number } = {},
): AsyncGenerator<JobRow[]> {
  let cursor = options.since ?? 0;
  const seen = new Map<number, number>();
  while (!signal.aborted) {
    const rows = db.select().from(jobs).where(gte(jobs.updatedAt, cursor))
      .orderBy(asc(jobs.updatedAt), asc(jobs.id)).all();
    const fresh = rows.filter((row) => seen.get(row.id) !== row.updatedAt);
    if (fresh.length > 0) {
      for (const row of fresh) seen.set(row.id, row.updatedAt);
      cursor = Math.max(cursor, ...fresh.map((row) => row.updatedAt));
      for (const [id, at] of seen) if (at < cursor) seen.delete(id);
      yield fresh;
    }
    await nap(options.pollMs ?? 1000, signal);
  }
}

export async function* pollLogs(
  db: Db,
  jobId: number,
  afterId: number,
  signal: AbortSignal,
  pollMs = 700,
): AsyncGenerator<ReturnType<typeof listLogs>> {
  let cursor = afterId;
  while (!signal.aborted) {
    const rows = listLogs(db, jobId, cursor);
    const last = rows.at(-1);
    if (last) {
      cursor = last.id;
      yield rows;
    }
    await nap(pollMs, signal);
  }
}
