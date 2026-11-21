import { biliCall } from "../../src/release/io";

export type DraftSummary = { id: string; title: string };

export async function fetchDrafts(): Promise<DraftSummary[]> {
  const body = await biliCall(
    "GET",
    "https://member.bilibili.com/x/vupre/web/draft/list?pn=1&ps=30",
  );
  if (body.code !== 0) throw new Error(`读取草稿箱失败 ${body.code} ${body.message ?? ""}`);
  const list = Array.isArray(body.data) ? body.data as Record<string, unknown>[] : [];
  return list.map((item) => ({
    id: String(item.id ?? item.draft_id ?? ""),
    title: String(item.title ?? (item.archive as { title?: string } | undefined)?.title ?? ""),
  })).filter((item) => item.id);
}

/** 读取失败（没登录、网络断）时只警告，当作草稿箱里没有数据库没记下的草稿。 */
export async function listDraftIds(): Promise<string[]> {
  try {
    return (await fetchDrafts()).map((draft) => draft.id);
  } catch (error) {
    console.warn(error instanceof Error ? error.message : error);
    return [];
  }
}
