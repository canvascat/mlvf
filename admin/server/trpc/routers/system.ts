import { readFile, statfs } from "node:fs/promises";
import path from "node:path";
import { cookiePath, runCommand } from "../../../../src/release/io";
import { defaultDbFile } from "../../db/client";
import { getSettings } from "../../settings";
import { publicProcedure, router } from "../init";

async function cookieState(): Promise<{ exists: boolean; expiresAt: number | null }> {
  try {
    const data = JSON.parse(await readFile(cookiePath, "utf8")) as {
      cookie_info?: { cookies?: { name: string; expires?: number }[] };
    };
    const session = data.cookie_info?.cookies?.find((cookie) => cookie.name === "SESSDATA");
    return { exists: true, expiresAt: session?.expires ? session.expires * 1000 : null };
  } catch {
    return { exists: false, expiresAt: null };
  }
}

async function whereIs(bin: string): Promise<string | null> {
  try {
    const found = await runCommand(["which", bin]);
    return found.exitCode === 0 ? found.output.trim() : null;
  } catch {
    return null;
  }
}

async function freeBytes(dir: string): Promise<number | null> {
  try {
    const stat = await statfs(dir);
    return Number(stat.bavail) * Number(stat.bsize);
  } catch {
    return null;
  }
}

export const systemRouter = router({
  health: publicProcedure.query(async ({ ctx }) => {
    const settings = getSettings(ctx.db);
    const out = path.join(process.cwd(), "out");
    const [cookies, biliup, ffmpeg, nub, outFree, cwdFree] = await Promise.all([
      cookieState(),
      whereIs(settings["bin.biliup"]),
      whereIs(settings["bin.ffmpeg"]),
      whereIs("nub"),
      freeBytes(out),
      freeBytes(process.cwd()),
    ]);
    return {
      cookies,
      binaries: { biliup, ffmpeg, nub },
      diskFreeBytes: outFree ?? cwdFree,
      dbFile: defaultDbFile(),
    };
  }),
});
