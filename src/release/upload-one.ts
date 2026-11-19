import { UPLOAD_GAP_MS } from "./schedule";
import { bvidFrom, classifyUpload } from "./upload-result";
import type { QueueItem } from "./queue";

export type UploadDeps = {
  cookie: string;
  run: (command: string[]) => Promise<{ exitCode: number; output: string }>;
  sleep: (ms: number) => Promise<void>;
  saveDraft: (item: QueueItem, output: string) => Promise<string>;
};

export async function uploadItem(
  item: QueueItem,
  deps: UploadDeps,
): Promise<{ status: "done"; bvid: string } | { status: "draft"; fromId: string; draftId: string }> {
  let alreadyWaitedGap = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await deps.run(commandFor(item, deps.cookie));
    const kind = classifyUpload(result.exitCode, result.output, alreadyWaitedGap);
    if (kind === "ok") {
      const bvid = bvidFrom(result.output);
      if (!bvid) throw new Error(`投稿失败 ${item.title}`);
      return { status: "done", bvid };
    }
    if (kind === "retry" && !alreadyWaitedGap) {
      await deps.sleep(UPLOAD_GAP_MS);
      alreadyWaitedGap = true;
      continue;
    }
    if (kind === "draft" || kind === "retry") {
      const draftId = await deps.saveDraft(item, result.output);
      return { status: "draft", fromId: item.id, draftId };
    }
    throw new Error(`投稿失败 ${item.title}`);
  }
  throw new Error(`投稿失败 ${item.title}`);
}

function commandFor(item: QueueItem, cookie: string): string[] {
  if (item.mode === "overwrite") {
    if (!item.bvid) throw new Error(`覆盖投稿缺少稿件号 ${item.title}`);
    return [
      "biliup", "-u", cookie, "append", "--submit", "web",
      "--vid", item.bvid, item.video,
    ];
  }
  const command = [
    "biliup", "-u", cookie, "upload", "--submit", "web",
    "--copyright", String(item.upload.copyright),
    "--tid", String(item.upload.tid),
    "--hires", String(item.upload.hires),
    "--cover", item.upload.cover,
    "--title", item.upload.title,
    "--tag", item.upload.tag,
    "--desc", item.upload.desc,
  ];
  if (item.upload.dynamic) {
    command.push("--dynamic", item.upload.dynamic);
  }
  command.push(item.video);
  return command;
}
