import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const JOB_KINDS = [
  "prepare", "export", "cover", "season", "upload", "publish_draft",
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATUSES = [
  "queued", "running", "succeeded", "failed", "cancel_requested", "cancelled", "interrupted",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const LANES = ["render", "bili"] as const;
export type Lane = (typeof LANES)[number];

export const albums = sqliteTable("albums", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  prepareDir: text("prepare_dir").notNull().unique(),
  title: text("title").notNull(),
  artist: text("artist").notNull().default(""),
  year: integer("year"),
  genre: text("genre"),
  coverPath: text("cover_path"),
  trackCount: integer("track_count").notNull().default(0),
  seasonId: integer("season_id"),
  sectionId: integer("section_id"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
});

export const tracks = sqliteTable("tracks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  albumId: integer("album_id").references(() => albums.id),
  trackNo: integer("track_no"),
  prepareDir: text("prepare_dir").notNull().default(""),
  configPath: text("config_path").notNull().unique(),
  audioPath: text("audio_path").notNull().default(""),
  lyricPath: text("lyric_path"),
  coverPath: text("cover_path"),
  textPath: text("text_path"),
  title: text("title").notNull(),
  artist: text("artist").notNull().default(""),
  albumTitle: text("album_title").notNull().default(""),
  composer: text("composer"),
  year: integer("year"),
  genre: text("genre"),
  durationSec: real("duration_sec"),
  lyricOffsetMs: integer("lyric_offset_ms"),
  lyricSource: text("lyric_source"),
  lyricFormat: text("lyric_format"),
  audioSampleRate: integer("audio_sample_rate"),
  audioBits: integer("audio_bits"),
  audioLossless: integer("audio_lossless", { mode: "boolean" }),
  exportStatus: text("export_status", { enum: ["none", "exported", "failed"] })
    .notNull().default("none"),
  createdAt: integer("created_at").notNull(),
}, (t) => [index("tracks_album_idx").on(t.albumId)]);

export const releases = sqliteTable("releases", {
  id: text("id").primaryKey(),
  trackId: integer("track_id").references(() => tracks.id),
  albumId: integer("album_id").references(() => albums.id),
  mode: text("mode", { enum: ["first", "overwrite"] }).notNull(),
  status: text("status", { enum: ["pending", "draft", "done"] }).notNull(),
  video: text("video").notNull().unique(),
  title: text("title").notNull(),
  bvid: text("bvid"),
  draftId: text("draft_id"),
  seasonId: integer("season_id"),
  sectionId: integer("section_id"),
  seasonAdded: integer("season_added", { mode: "boolean" }),
  uploadTitle: text("upload_title").notNull(),
  uploadDesc: text("upload_desc").notNull(),
  uploadTag: text("upload_tag").notNull(),
  uploadCover: text("upload_cover").notNull(),
  uploadTid: integer("upload_tid").notNull().default(130),
  uploadCopyright: integer("upload_copyright").notNull().default(1),
  uploadDynamic: text("upload_dynamic").notNull().default(""),
  uploadHires: integer("upload_hires").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  finishedAt: integer("finished_at"),
}, (t) => [
  check("releases_owner", sql`(${t.trackId} IS NOT NULL) <> (${t.albumId} IS NOT NULL)`),
  index("releases_status_idx").on(t.status),
]);

export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: JOB_KINDS }).notNull(),
  lane: text("lane", { enum: LANES }).notNull(),
  status: text("status", { enum: JOB_STATUSES }).notNull().default("queued"),
  albumId: integer("album_id").references(() => albums.id),
  trackId: integer("track_id").references(() => tracks.id),
  /** 不设外键：入队时 releases 行还没建，要等 cover 任务才建。 */
  releaseId: text("release_id"),
  dependsOn: text("depends_on", { mode: "json" }).$type<number[]>().notNull(),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  progress: real("progress").notNull().default(0),
  result: text("result", { mode: "json" }).$type<unknown>(),
  error: text("error"),
  attempt: integer("attempt").notNull().default(0),
  runAfter: integer("run_after").notNull().default(0),
  retryOf: integer("retry_of"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  startedAt: integer("started_at"),
  finishedAt: integer("finished_at"),
}, (t) => [
  index("jobs_claim_idx").on(t.lane, t.status, t.runAfter),
  index("jobs_updated_idx").on(t.updatedAt),
]);

export const jobLogs = sqliteTable("job_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull().references(() => jobs.id),
  ts: integer("ts").notNull(),
  stream: text("stream", { enum: ["stdout", "stderr", "system"] }).notNull(),
  line: text("line").notNull(),
}, (t) => [index("job_logs_job_idx").on(t.jobId, t.id)]);

export const runnerState = sqliteTable("runner_state", {
  id: integer("id").primaryKey(),
  lockedSince: integer("locked_since"),
  holdUntil: integer("hold_until"),
  lastUploadOkAt: integer("last_upload_ok_at"),
  pid: integer("pid"),
  heartbeatAt: integer("heartbeat_at"),
}, (t) => [check("runner_state_single", sql`${t.id} = 1`)]);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>().notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type AlbumRow = typeof albums.$inferSelect;
export type TrackRow = typeof tracks.$inferSelect;
export type ReleaseRow = typeof releases.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
