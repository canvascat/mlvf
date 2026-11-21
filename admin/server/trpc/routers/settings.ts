import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { settings as settingsTable } from "../../db/schema";
import {
  SETTING_DEFAULTS, SETTING_KEYS, getSettings, resetSettings, settingWarnings, updateSettings,
  type SettingKey, type Settings,
} from "../../settings";
import { publicProcedure, router } from "../init";
import type { Db } from "../../db/client";

function snapshot(db: Db) {
  const values = getSettings(db);
  const updatedAt = Object.fromEntries(
    db.select().from(settingsTable).all().map((row) => [row.key, row.updatedAt]),
  ) as Record<string, number>;
  return { values, defaults: SETTING_DEFAULTS, warnings: settingWarnings(values), updatedAt };
}

export const settingsRouter = router({
  get: publicProcedure.query(({ ctx }) => snapshot(ctx.db)),

  update: publicProcedure.input(z.record(z.string(), z.unknown())).mutation(({ ctx, input }) => {
    try {
      updateSettings(ctx.db, input as Partial<Settings>);
    } catch (error) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return snapshot(ctx.db);
  }),

  reset: publicProcedure
    .input(z.object({ keys: z.array(z.enum(SETTING_KEYS as [SettingKey, ...SettingKey[]])).optional() }))
    .mutation(({ ctx, input }) => {
      resetSettings(ctx.db, input.keys);
      return snapshot(ctx.db);
    }),
});
