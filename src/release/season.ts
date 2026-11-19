export type SeasonSection = { id: number; title: string };

export type SeasonRecord = {
  id: number;
  title: string;
  noSection: number;
  sections: SeasonSection[];
};

export type SeasonClient = {
  list: () => Promise<SeasonRecord[]>;
  uploadCover: (file: string) => Promise<string>;
  create: (body: { title: string; desc: string; cover: string }) => Promise<number>;
  switchGroup: (seasonId: number) => Promise<void>;
  renameSection: (seasonId: number, sectionId: number, title: string) => Promise<void>;
  pause: () => Promise<void>;
};

export async function ensureSeason(input: {
  title: string;
  sectionTitle: string;
  desc: string;
  coverPath: string;
  client: SeasonClient;
}): Promise<{ seasonId: number; sectionId: number }> {
  let existing = (await input.client.list()).find((season) => season.title === input.title);
  if (!existing) {
    const cover = await input.client.uploadCover(input.coverPath);
    const seasonId = await input.client.create({
      title: input.title,
      desc: input.desc,
      cover,
    });
    await input.client.pause();
    existing = (await input.client.list()).find((season) => season.id === seasonId);
    if (!existing) throw new Error(`创建后没有找到合集 ${seasonId}`);
  }
  let seasonId = existing.id;
  if (existing.noSection !== 0) {
    await input.client.switchGroup(seasonId);
    await input.client.pause();
    existing = (await input.client.list()).find((season) => season.id === seasonId);
    if (!existing) throw new Error(`打开分组后没有找到合集 ${seasonId}`);
  }
  const named = existing.sections.find((section) => section.title === input.sectionTitle);
  if (named) return { seasonId, sectionId: named.id };
  const feature = existing.sections.find((section) => section.title === "正片");
  if (!feature) throw new Error("没有正片小节");
  await input.client.renameSection(seasonId, feature.id, input.sectionTitle);
  await input.client.pause();
  return { seasonId, sectionId: feature.id };
}

export function classifySeasonAdd(
  exitCode: number,
  output: string,
): "ok" | "wait-rate" | "wait-missing" | "fail" {
  if (
    output.includes("已将")
    || output.includes("已存在")
    || /(?<!\d)20080(?!\d)/.test(output)
  ) {
    return "ok";
  }
  if (/(?<!\d)20111(?!\d)/.test(output) || /(?<!\d)256000(?!\d)/.test(output)) {
    return "wait-rate";
  }
  if (output.includes("啥都木有") || output.includes("-404")) {
    return "wait-missing";
  }
  if (exitCode !== 0) return "fail";
  return "fail";
}
