import { createHash } from "node:crypto";
import path from "node:path";

export type QueueUpload = {
  title: string;
  desc: string;
  tag: string;
  cover: string;
  tid: number;
  copyright: number;
  dynamic: string;
  hires: 0 | 1;
};

export type QueueItem = {
  id: string;
  mode: "first" | "overwrite";
  status: "pending" | "draft" | "done";
  video: string;
  title: string;
  created: string;
  bvid?: string;
  season_id?: number;
  section_id?: number;
  season_added?: boolean;
  draft_id?: string;
  finished?: string;
  upload: QueueUpload;
};

export type QueueFile = {
  locked_since: string | null;
  hold_until: string | null;
  items: QueueItem[];
};

export function emptyQueue(): QueueFile {
  return { locked_since: null, hold_until: null, items: [] };
}

export function batchKey(prepareDir: string): string {
  return createHash("sha256").update(path.basename(prepareDir)).digest("hex").slice(0, 8);
}

export function releaseItemId(prepareDir: string, index: number): string {
  return `release-${batchKey(prepareDir)}-${String(index).padStart(2, "0")}`;
}

export function upsertPending(queue: QueueFile, item: QueueItem): QueueFile {
  const index = queue.items.findIndex((existing) => existing.video === item.video);
  if (index === -1) {
    return { ...queue, items: [...queue.items, item] };
  }
  const existing = queue.items[index];
  if (!existing || existing.status !== "pending") {
    return queue;
  }
  const items = queue.items.slice();
  items[index] = {
    ...item,
    id: existing.id,
    mode: existing.mode,
    bvid: existing.bvid,
  };
  return { ...queue, items };
}

export function pendingOf(queue: QueueFile, ids: string[]): QueueItem[] {
  const pending = new Map(
    queue.items.filter((item) => item.status === "pending").map((item) => [item.id, item]),
  );
  return ids.flatMap((id) => {
    const item = pending.get(id);
    return item ? [item] : [];
  });
}
