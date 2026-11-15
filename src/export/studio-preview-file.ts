import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { StudioPreviewOverride } from "../helpers/studio-preview";

function projectRoot(): string {
  return process.cwd();
}

export function studioPreviewGeneratedPath(): string {
  return path.join(projectRoot(), "src/helpers/studio-preview.generated.ts");
}

export async function writeStudioPreviewOverride(
  override: StudioPreviewOverride | null,
): Promise<void> {
  const serialized =
    override === null ? "null" : JSON.stringify(override, null, 2);
  const source = `// 由 export --preview 生成。勿手改。
import type { StudioPreviewOverride } from "./studio-preview";

export const studioPreviewOverride: StudioPreviewOverride | null = ${serialized};
`;
  await writeFile(studioPreviewGeneratedPath(), source, "utf8");
}