CREATE TABLE `albums` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`prepare_dir` text NOT NULL UNIQUE,
	`title` text NOT NULL,
	`artist` text DEFAULT '' NOT NULL,
	`year` integer,
	`genre` text,
	`cover_path` text,
	`track_count` integer DEFAULT 0 NOT NULL,
	`season_id` integer,
	`section_id` integer,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `job_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`job_id` integer NOT NULL,
	`ts` integer NOT NULL,
	`stream` text NOT NULL,
	`line` text NOT NULL,
	CONSTRAINT `fk_job_logs_job_id_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`)
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`kind` text NOT NULL,
	`lane` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`album_id` integer,
	`track_id` integer,
	`release_id` text,
	`depends_on` text NOT NULL,
	`payload` text NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`result` text,
	`error` text,
	`attempt` integer DEFAULT 0 NOT NULL,
	`run_after` integer DEFAULT 0 NOT NULL,
	`retry_of` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	CONSTRAINT `fk_jobs_album_id_albums_id_fk` FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`),
	CONSTRAINT `fk_jobs_track_id_tracks_id_fk` FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`)
);
--> statement-breakpoint
CREATE TABLE `releases` (
	`id` text PRIMARY KEY,
	`track_id` integer,
	`album_id` integer,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`video` text NOT NULL UNIQUE,
	`title` text NOT NULL,
	`bvid` text,
	`draft_id` text,
	`season_id` integer,
	`section_id` integer,
	`season_added` integer,
	`upload_title` text NOT NULL,
	`upload_desc` text NOT NULL,
	`upload_tag` text NOT NULL,
	`upload_cover` text NOT NULL,
	`upload_tid` integer DEFAULT 130 NOT NULL,
	`upload_copyright` integer DEFAULT 1 NOT NULL,
	`upload_dynamic` text DEFAULT '' NOT NULL,
	`upload_hires` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	CONSTRAINT `fk_releases_track_id_tracks_id_fk` FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`),
	CONSTRAINT `fk_releases_album_id_albums_id_fk` FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`),
	CONSTRAINT "releases_owner" CHECK(("track_id" IS NOT NULL) <> ("album_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `runner_state` (
	`id` integer PRIMARY KEY,
	`locked_since` integer,
	`hold_until` integer,
	`last_upload_ok_at` integer,
	`pid` integer,
	`heartbeat_at` integer,
	CONSTRAINT "runner_state_single" CHECK("id" = 1)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tracks` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`album_id` integer,
	`track_no` integer,
	`prepare_dir` text DEFAULT '' NOT NULL,
	`config_path` text NOT NULL UNIQUE,
	`audio_path` text DEFAULT '' NOT NULL,
	`lyric_path` text,
	`cover_path` text,
	`text_path` text,
	`title` text NOT NULL,
	`artist` text DEFAULT '' NOT NULL,
	`album_title` text DEFAULT '' NOT NULL,
	`composer` text,
	`year` integer,
	`genre` text,
	`duration_sec` real,
	`lyric_offset_ms` integer,
	`lyric_source` text,
	`lyric_format` text,
	`audio_sample_rate` integer,
	`audio_bits` integer,
	`audio_lossless` integer,
	`export_status` text DEFAULT 'none' NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_tracks_album_id_albums_id_fk` FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`)
);
--> statement-breakpoint
CREATE INDEX `job_logs_job_idx` ON `job_logs` (`job_id`,`id`);--> statement-breakpoint
CREATE INDEX `jobs_claim_idx` ON `jobs` (`lane`,`status`,`run_after`);--> statement-breakpoint
CREATE INDEX `jobs_updated_idx` ON `jobs` (`updated_at`);--> statement-breakpoint
CREATE INDEX `releases_status_idx` ON `releases` (`status`);--> statement-breakpoint
CREATE INDEX `tracks_album_idx` ON `tracks` (`album_id`);