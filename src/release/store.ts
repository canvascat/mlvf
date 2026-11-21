import { readFileSync, writeFileSync } from "node:fs";
import { emptyQueue, type QueueFile, type QueueItem } from "./queue";

/** 队列的读写接口。release 命令和 runner 都经它读写，底层可以是 JSON 文件或数据库。 */
export type QueueStore = {
  load(): QueueFile;
  /** 只写入相对上次 load 有变化的条目，避免用过期快照覆盖别处的更新。 */
  save(queue: QueueFile): void;
  patch(id: string, update: (item: QueueItem) => void): QueueItem | undefined;
};

export function jsonQueueStore(file: string): QueueStore {
  const load = (): QueueFile => {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as QueueFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyQueue();
      throw error;
    }
  };
  const save = (queue: QueueFile) => writeFileSync(file, JSON.stringify(queue, null, 2) + "\n");
  return {
    load,
    save,
    patch(id, update) {
      const queue = load();
      const item = queue.items.find((entry) => entry.id === id);
      if (!item) return undefined;
      update(item);
      save(queue);
      return item;
    },
  };
}
