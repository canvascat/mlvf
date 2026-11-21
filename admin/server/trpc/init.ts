// admin/server/trpc/init.ts
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { Db } from "../db/client";

export type Context = { db: Db };

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;
