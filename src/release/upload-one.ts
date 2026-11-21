import { UPLOAD_GAP_MS } from "./schedule";
import { bvidFrom, classifyUpload } from "./upload-result";
import type { QueueItem } from "./queue";

export type UploadDeps = {
  cookie: string;
  /** biliup 可执行文件，默认 "biliup"。 */
  bin?: string;
  /** 21566 之后等多久再试同一条，默认 UPLOAD_GAP_MS。 */
  retryWaitMs?: number;
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
    const result = await deps.run(commandFor(item, deps.cookie, deps.bin ?? "biliup"));
    const kind = classifyUpload(result.exitCode, result.output, alreadyWaitedGap);
    if (kind === "ok") {
      const bvid = bvidFrom(result.output);
      if (!bvid) failUpload(item.title, result.output);
      return { status: "done", bvid };
    }
    if (kind === "retry" && !alreadyWaitedGap) {
      await deps.sleep(deps.retryWaitMs ?? UPLOAD_GAP_MS);
      alreadyWaitedGap = true;
      continue;
    }
    if (kind === "draft" || kind === "retry") {
      const draftId = await deps.saveDraft(item, result.output);
      return { status: "draft", fromId: item.id, draftId };
    }
    failUpload(item.title, result.output);
  }
  throw new Error(`投稿失败 ${item.title}`);
}

function failUpload(title: string, output: string): never {
  const tail = output.trim().split("\n").slice(-20).join("\n");
  throw new Error(tail ? `投稿失败 ${title}\n${tail}` : `投稿失败 ${title}`);
}

function commandFor(item: QueueItem, cookie: string, bin: string): string[] {
  if (item.mode === "overwrite") {
    if (!item.bvid) throw new Error(`覆盖投稿缺少稿件号 ${item.title}`);
    return [
      bin, "-u", cookie, "append", "--submit", "web",
      "--vid", item.bvid, item.video,
    ];
  }
  const command = [
    bin, "-u", cookie, "upload", "--submit", "web",
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
