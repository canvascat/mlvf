import { bootDb } from "../boot";
import type { Db } from "./client";

const KEY = Symbol.for("rmv.admin.db");

/** web 进程里共用一个连接。挂在 globalThis 上，开发时热更新不会重复打开。 */
export function getDb(): Db {
  const holder = globalThis as Record<symbol, Db | undefined>;
  holder[KEY] ??= bootDb();
  return holder[KEY];
}
