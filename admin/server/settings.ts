import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Conn, Db } from "./db/client";
import { settings as settingsTable } from "./db/schema";

const int = (min: number, max: number) => z.number().int().min(min).max(max);

export const settingsShape = {
  "render.maxParallel": int(1, 8),
  "render.frameConcurrency": z.string().regex(/^(\d+|\d+%)$/, "填数字或百分比，如 2 或 50%"),
  "bili.maxParallel": int(1, 8),
  "upload.minIntervalSec": int(0, 86_400),
  "season.writeIntervalSec": int(0, 600),
  "retry.rateLimitWaitSec": int(0, 3600),
  "retry.editBusyWaitSec": int(0, 600),
  "retry.notFoundWaitSec": int(0, 600),
  "idle.enabled": z.boolean(),
  "idle.nightStartHour": int(0, 23),
  "idle.nightEndHour": int(1, 24),
  "idle.lockMinutes": int(1, 1440),
  "idle.tickSec": int(5, 3600),
  "draft.capacity": int(1, 100),
  "log.maxLinesPerJob": int(100, 100_000),
  "bin.biliup": z.string().min(1),
  "bin.ffmpeg": z.string().min(1),
} as const;

export type Settings = { [K in keyof typeof settingsShape]: z.infer<(typeof settingsShape)[K]> };
export type SettingKey = keyof Settings;

export const SETTING_DEFAULTS: Settings = {
  "render.maxParallel": 1,
  "render.frameConcurrency": "1",
  "bili.maxParallel": 1,
  "upload.minIntervalSec": 180,
  "season.writeIntervalSec": 3,
  "retry.rateLimitWaitSec": 180,
  "retry.editBusyWaitSec": 20,
  "retry.notFoundWaitSec": 30,
  "idle.enabled": true,
  "idle.nightStartHour": 0,
  "idle.nightEndHour": 6,
  "idle.lockMinutes": 10,
  "idle.tickSec": 60,
  "draft.capacity": 30,
  "log.maxLinesPerJob": 5000,
  "bin.biliup": "biliup",
  "bin.ffmpeg": "ffmpeg",
};

export const SETTING_KEYS = Object.keys(settingsShape) as SettingKey[];

export function getSettings(conn: Conn): Settings {
  const stored = new Map(conn.select().from(settingsTable).all().map((row) => [row.key, row.value]));
  const result: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    const parsed = settingsShape[key].safeParse(stored.get(key));
    result[key] = parsed.success ? parsed.data : SETTING_DEFAULTS[key];
  }
  return result as Settings;
}

export function updateSettings(db: Db, patch: Partial<Settings>, now: number = Date.now()): Settings {
  const entries = Object.entries(patch) as [SettingKey, unknown][];
  for (const [key, value] of entries) {
    if (!(key in settingsShape)) throw new Error(`未知配置项: ${key}`);
    const parsed = settingsShape[key].safeParse(value);
    if (!parsed.success) throw new Error(`${key}: ${parsed.error.issues[0]?.message ?? "取值不合法"}`);
  }
  const merged = { ...getSettings(db), ...patch };
  if (merged["idle.nightStartHour"] >= merged["idle.nightEndHour"]) {
    throw new Error("idle.nightStartHour 必须小于 idle.nightEndHour");
  }
  db.transaction((tx) => {
    for (const [key, value] of entries) {
      tx.insert(settingsTable).values({ key, value, updatedAt: now })
        .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: now } }).run();
    }
  });
  return getSettings(db);
}

export function resetSettings(db: Db, keys?: SettingKey[]): Settings {
  if (keys) db.delete(settingsTable).where(inArray(settingsTable.key, keys)).run();
  else db.delete(settingsTable).run();
  return getSettings(db);
}

export type SettingWarning = { key: SettingKey; message: string };

export function settingWarnings(settings: Settings): SettingWarning[] {
  const warnings: SettingWarning[] = [];
  if (settings["upload.minIntervalSec"] < 180) {
    warnings.push({ key: "upload.minIntervalSec", message: "低于 180 秒容易触发 21566、137022 投稿过于频繁" });
  }
  if (settings["bili.maxParallel"] > 1) {
    warnings.push({ key: "bili.maxParallel", message: "AGENTS.md 要求不并行投稿，并行容易触发 21566" });
  }
  if (settings["render.maxParallel"] > 1) {
    warnings.push({ key: "render.maxParallel", message: "多路同时渲染会占用大量内存和 Chrome 进程" });
  }
  return warnings;
}

export function settingUpdatedAt(conn: Conn, key: SettingKey): number | null {
  return conn.select().from(settingsTable).where(eq(settingsTable.key, key)).get()?.updatedAt ?? null;
}
