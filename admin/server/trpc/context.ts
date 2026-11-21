// admin/server/trpc/context.ts
import { getDb } from "../db/instance";
import type { Context } from "./init";

export function createContext(): Context {
  return { db: getDb() };
}
