import { existsSync } from "node:fs";
import { queuePath } from "../../src/release/io";
import { openDb, type Db } from "./db/client";
import { importQueueJson } from "./queue-store";

/** 打开数据库并迁移；旧的 tmp/upload-queue.json 还在就一次性导入（成功后文件改名为 .imported）。 */
export function bootDb(file?: string): Db {
  const db = openDb(file);
  if (existsSync(queuePath)) {
    const result = importQueueJson(db, queuePath);
    if (result.imported > 0) console.log(`已从 ${queuePath} 导入 ${result.imported} 条投稿记录`);
  }
  return db;
}
