import { assertNoOtherUpload, uploadById } from "../../../../src/release/ops";
import type { Executor } from "../types";
import { makeReleaseRuntime, markUploadOk, waitForUploadGap } from "./support";

export const uploadExecutor: Executor = async (job, ctx) => {
  const releaseId = String(job.payload.releaseId ?? job.releaseId ?? "");
  if (!releaseId) throw new Error("upload 任务缺少 releaseId");
  const rt = makeReleaseRuntime(ctx);
  await waitForUploadGap(ctx);
  // runner 自己会起 biliup 子进程，只防「别的 release CLI 正在投稿」。
  // bili.maxParallel > 1 时用户已经选择了并行，不再互斥。
  if (ctx.settings["bili.maxParallel"] === 1) {
    await assertNoOtherUpload(rt, "src/release/cli.ts");
  }
  const outcome = await uploadById(rt, releaseId, new Set());
  if (outcome === "uploaded") markUploadOk(ctx.db, Date.now());
  return { outcome };
};
