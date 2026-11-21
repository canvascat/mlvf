import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";

export function createDb(file: string) {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const client = new DatabaseSync(file);
  client.exec("PRAGMA busy_timeout = 5000;");
  if (file !== ":memory:") client.exec("PRAGMA journal_mode = WAL;");
  client.exec("PRAGMA foreign_keys = ON;");
  return drizzle({ client });
}

export type Db = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Conn = Db | Tx;

const MIGRATIONS = fileURLToPath(new URL("./migrations", import.meta.url));

export function migrateDb(db: Db): void {
  const failure = migrate(db, { migrationsFolder: MIGRATIONS });
  if (failure) throw new Error(`数据库迁移失败: ${JSON.stringify(failure)}`);
  db.run("INSERT OR IGNORE INTO runner_state (id) VALUES (1)");
}

export function defaultDbFile(): string {
  return process.env.RMV_DB ?? path.join(process.cwd(), "data", "rmv.db");
}

export function openDb(file: string = defaultDbFile()): Db {
  const db = createDb(file);
  migrateDb(db);
  return db;
}
