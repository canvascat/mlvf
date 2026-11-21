import { eq } from "drizzle-orm";
import { biliCall, readCookies } from "../../../../src/release/io";
import { addToSeason } from "../../../../src/release/ops";
import { releases } from "../../db/schema";
import type { Executor } from "../types";
import { makeReleaseRuntime, markUploadOk } from "./support";

/** 稿件级字段。不带 aid：这是新发布，不是编辑。 */
const PUBLISH_KEYS = [
  "copyright", "source", "tid", "cover", "title", "desc_format_id", "desc", "desc_v2",
  "dynamic", "tag", "interactive", "no_reprint", "charging_pay",
  "is_only_self", "mission_id", "dtime",
];

type DraftVideo = { filename: string; title?: string; desc?: string; cid: number };

export function buildPublishBody(
  view: Record<string, unknown>,
  hires: number,
): Record<string, unknown> {
  const source = (view.archive as Record<string, unknown> | undefined) ?? view;
  const videos = (view.videos ?? source.videos) as DraftVideo[] | undefined;
  if (!videos || videos.length === 0) throw new Error("草稿里没有视频，无法发布");
  const body: Record<string, unknown> = {};
  for (const key of PUBLISH_KEYS) {
    if (source[key] != null) body[key] = source[key];
  }
  body.videos = videos.map((video) => ({
    filename: video.filename,
    title: video.title ?? "",
    desc: video.desc ?? "",
    cid: video.cid,
  }));
  body.subtitle = { open: 0, lan: "" };
  body.dolby = 0;
  body.lossless_music = hires;
  body.up_selection_reply = false;
  body.up_close_reply = false;
  body.up_close_danmu = false;
  body.web_os = 3;
  return body;
}

export const publishDraftExecutor: Executor = async (job, ctx) => {
  const draftId = String(job.payload.draftId ?? "");
  if (!draftId) throw new Error("publish_draft 任务缺少 draftId");
  const rt = makeReleaseRuntime(ctx);
  const releaseId = String(job.payload.releaseId ?? job.releaseId ?? "");
  const release = releaseId
    ? ctx.db.select().from(releases).where(eq(releases.id, releaseId)).get()
    : undefined;

  const viewed = await biliCall(
    "GET",
    `https://member.bilibili.com/x/vupre/web/draft/view?id=${encodeURIComponent(draftId)}`,
  );
  if (viewed.code !== 0) throw new Error(`读取草稿失败 ${viewed.code} ${viewed.message ?? ""}`);
  const body = buildPublishBody(
    (viewed.data ?? {}) as Record<string, unknown>,
    release?.uploadHires ?? 0,
  );

  const { csrf } = await readCookies();
  const added = await biliCall(
    "POST",
    `https://member.bilibili.com/x/vu/web/add/v3?csrf=${csrf}`,
    JSON.stringify(body),
    "application/json",
  );
  if (added.code !== 0) {
    throw new Error(`发布草稿失败 ${added.code} ${added.message ?? ""}，草稿保留`);
  }
  const bvid = String((added.data as { bvid?: string } | undefined)?.bvid ?? "");
  if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) throw new Error("发布返回里没有 BV 号，草稿保留");
  markUploadOk(ctx.db, Date.now());
  ctx.log(`草稿 ${draftId} 已发布 ${bvid}`);

  // 先把结果记下来，再做删除草稿和加合集这些可以失败的收尾。
  let seasonAdded: boolean | undefined;
  if (releaseId) {
    const current = rt.store.patch(releaseId, (item) => {
      item.status = "done";
      item.bvid = bvid;
      item.finished = new Date().toISOString();
      item.season_added = false;
    });
    if (current) {
      seasonAdded = await addToSeason(rt, current, bvid);
      rt.store.patch(releaseId, (item) => { item.season_added = seasonAdded; });
    }
  }

  await rt.sleep(rt.timing.writeIntervalMs);
  const deleted = await biliCall(
    "POST",
    `https://member.bilibili.com/x/vupre/web/draft/delete?csrf=${csrf}`,
    new URLSearchParams({ id: draftId }).toString(),
    "application/x-www-form-urlencoded",
  );
  if (deleted.code !== 0) {
    ctx.log(`草稿 ${draftId} 删除失败 ${deleted.code} ${deleted.message ?? ""}。不重试，请到草稿箱手动删除`);
  }
  return { bvid, seasonAdded, draftDeleted: deleted.code === 0 };
};
