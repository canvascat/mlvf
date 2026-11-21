import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Conn, Db } from "./db/client";
import { jobLogs, jobs, type JobKind, type JobRow, type Lane } from "./db/schema";
import { redactSecrets } from "./redact";

const RENDER_KINDS = new Set<JobKind>(["prepare", "export", "cover"]);

export function laneOf(kind: JobKind): Lane {
  return RENDER_KINDS.has(kind) ? "render" : "bili";
}

export type NewJob = {
  kind: JobKind;
  albumId?: number;
  trackId?: number;
  releaseId?: string;
  dependsOn?: number[];
  payload?: Record<string, unknown>;
  runAfter?: number;
  retryOf?: number;
};

export function enqueueJob(conn: Conn, job: NewJob, now: number = Date.now()): JobRow {
  return conn.insert(jobs).values({
    kind: job.kind,
    lane: laneOf(job.kind),
    albumId: job.albumId ?? null,
    trackId: job.trackId ?? null,
    releaseId: job.releaseId ?? null,
    dependsOn: job.dependsOn ?? [],
    payload: job.payload ?? {},
    runAfter: job.runAfter ?? 0,
    retryOf: job.retryOf ?? null,
    createdAt: now,
    updatedAt: now,
  }).returning().get();
}

export function getJob(conn: Conn, id: number): JobRow | undefined {
  return conn.select().from(jobs).where(eq(jobs.id, id)).get();
}

/** 原子领取：同一条语句里挑出并改成 running，所以同一个任务只会被一个调用者拿到。 */
export function claimNext(conn: Conn, lane: Lane, now: number): JobRow | undefined {
  return conn.update(jobs)
    .set({
      status: "running",
      startedAt: now,
      updatedAt: now,
      finishedAt: null,
      error: null,
      progress: 0,
      attempt: sql`${jobs.attempt} + 1`,
    })
    .where(eq(jobs.id, sql`(
      SELECT j.id FROM jobs AS j
      WHERE j.lane = ${lane} AND j.status = 'queued' AND j.run_after <= ${now}
        AND NOT EXISTS (
          SELECT 1 FROM json_each(j.depends_on) AS d
          JOIN jobs AS p ON p.id = d.value
          WHERE p.status <> 'succeeded')
      ORDER BY j.id LIMIT 1)`))
    .returning().all()[0];
}

export function countRunning(conn: Conn, lane: Lane): number {
  const row = conn.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(jobs)
    .where(and(eq(jobs.lane, lane), inArray(jobs.status, ["running", "cancel_requested"])))
    .get();
  return row?.n ?? 0;
}

export type JobOutcome =
  | { status: "succeeded"; result?: unknown }
  | { status: "failed"; error: string }
  | { status: "cancelled" }
  | { status: "interrupted"; error?: string };

export function finishJob(db: Db, id: number, outcome: JobOutcome, now: number): void {
  db.transaction((tx) => {
    const error = outcome.status === "failed" ? outcome.error
      : outcome.status === "cancelled" ? "已取消"
      : outcome.status === "interrupted" ? (outcome.error ?? "任务被中断")
      : null;
    tx.update(jobs).set({
      status: outcome.status,
      error,
      finishedAt: now,
      updatedAt: now,
      ...(outcome.status === "succeeded"
        ? { progress: 1, result: outcome.result ?? null }
        : {}),
    }).where(eq(jobs.id, id)).run();
    if (outcome.status !== "succeeded") cascadeDependencyFailures(tx, now);
  });
}

const BAD = "('failed','cancelled','interrupted')";

/** 依赖已失败、取消或中断的排队任务，一路改成 cancelled（原因「依赖失败」）。 */
export function cascadeDependencyFailures(conn: Conn, now: number): number {
  let total = 0;
  for (;;) {
    const stuck = conn.all<{ id: number | bigint; dep: number | bigint }>(sql`
      SELECT j.id AS id,
        (SELECT p.id FROM json_each(j.depends_on) AS d JOIN jobs AS p ON p.id = d.value
          WHERE p.status IN ${sql.raw(BAD)} LIMIT 1) AS dep
      FROM jobs AS j
      WHERE j.status = 'queued' AND EXISTS (
        SELECT 1 FROM json_each(j.depends_on) AS d JOIN jobs AS p ON p.id = d.value
        WHERE p.status IN ${sql.raw(BAD)})`);
    if (stuck.length === 0) return total;
    for (const row of stuck) {
      conn.update(jobs).set({
        status: "cancelled",
        error: `依赖失败: #${Number(row.dep)}`,
        finishedAt: now,
        updatedAt: now,
      }).where(eq(jobs.id, Number(row.id))).run();
      total += 1;
    }
  }
}

export function requestCancel(db: Db, id: number, now: number): "cancelled" | "requested" | "noop" {
  return db.transaction((tx) => {
    const job = getJob(tx, id);
    if (!job) return "noop";
    if (job.status === "queued") {
      tx.update(jobs).set({ status: "cancelled", error: "已取消", finishedAt: now, updatedAt: now })
        .where(eq(jobs.id, id)).run();
      cascadeDependencyFailures(tx, now);
      return "cancelled";
    }
    if (job.status === "running") {
      tx.update(jobs).set({ status: "cancel_requested", updatedAt: now }).where(eq(jobs.id, id)).run();
      return "requested";
    }
    return "noop";
  });
}

export function cancelRequestedIds(conn: Conn): number[] {
  return conn.select({ id: jobs.id }).from(jobs)
    .where(eq(jobs.status, "cancel_requested")).all().map((row) => row.id);
}

export function setProgress(conn: Conn, id: number, progress: number, now: number): void {
  const clamped = Math.min(1, Math.max(0, progress));
  conn.update(jobs).set({ progress: clamped, updatedAt: now }).where(eq(jobs.id, id)).run();
}

const isCascaded = (job: JobRow) =>
  job.status === "cancelled" && (job.error ?? "").startsWith("依赖失败");

/** 重试：新建一条任务，并把依赖旧任务的后续任务改指向新任务、必要时复活。 */
export function retryJob(db: Db, id: number, now: number): JobRow {
  return db.transaction((tx) => {
    const old = getJob(tx, id);
    if (!old) throw new Error(`找不到任务 #${id}`);
    if (!["failed", "cancelled", "interrupted"].includes(old.status)) {
      throw new Error("只有失败、取消或中断的任务可以重试");
    }
    const fresh = enqueueJob(tx, {
      kind: old.kind,
      albumId: old.albumId ?? undefined,
      trackId: old.trackId ?? undefined,
      releaseId: old.releaseId ?? undefined,
      dependsOn: old.dependsOn,
      payload: old.payload,
      retryOf: old.id,
    }, now);
    const dependents = tx.select().from(jobs).where(sql`EXISTS (
      SELECT 1 FROM json_each(${jobs.dependsOn}) AS d WHERE d.value = ${old.id})`).all();
    for (const dependent of dependents) {
      if (dependent.status !== "queued" && !isCascaded(dependent)) continue;
      tx.update(jobs).set({
        dependsOn: dependent.dependsOn.map((dep) => (dep === old.id ? fresh.id : dep)),
        updatedAt: now,
      }).where(eq(jobs.id, dependent.id)).run();
    }
    reviveCascaded(tx, now);
    return fresh;
  });
}

function reviveCascaded(conn: Conn, now: number): void {
  const candidates = conn.select().from(jobs).where(eq(jobs.status, "cancelled"))
    .orderBy(asc(jobs.id)).all().filter(isCascaded);
  for (const job of candidates) {
    const deps = job.dependsOn.map((dep) => getJob(conn, dep)?.status);
    const alive = deps.every((status) =>
      status === undefined || ["queued", "running", "succeeded", "cancel_requested"].includes(status));
    if (!alive) continue;
    conn.update(jobs).set({ status: "queued", error: null, finishedAt: null, updatedAt: now })
      .where(eq(jobs.id, job.id)).run();
  }
}

export function recoverInterrupted(db: Db, now: number): number {
  return db.transaction((tx) => {
    const hit = tx.update(jobs).set({
      status: "interrupted",
      error: "任务被中断（runner 重启或退出）",
      finishedAt: now,
      updatedAt: now,
    }).where(inArray(jobs.status, ["running", "cancel_requested"])).returning({ id: jobs.id }).all();
    cascadeDependencyFailures(tx, now);
    return hit.length;
  });
}

export type LogEntry = { stream: "stdout" | "stderr" | "system"; line: string };

export function appendLogs(
  conn: Conn,
  jobId: number,
  entries: LogEntry[],
  now: number,
  maxLines: number,
): void {
  if (entries.length === 0) return;
  conn.insert(jobLogs).values(entries.map((entry) => ({
    jobId, ts: now, stream: entry.stream, line: redactSecrets(entry.line),
  }))).run();
  conn.delete(jobLogs).where(and(
    eq(jobLogs.jobId, jobId),
    sql`${jobLogs.id} <= (SELECT id FROM job_logs WHERE job_id = ${jobId}
      ORDER BY id DESC LIMIT 1 OFFSET ${maxLines})`,
  )).run();
}

export function listLogs(conn: Conn, jobId: number, afterId: number, limit = 500) {
  return conn.select().from(jobLogs)
    .where(and(eq(jobLogs.jobId, jobId), gt(jobLogs.id, afterId)))
    .orderBy(asc(jobLogs.id)).limit(limit).all();
}
