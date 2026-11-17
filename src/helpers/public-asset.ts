import { staticFile } from "remotion";

export function resolvePublicAsset(src: string | undefined): string {
  if (!src || src.trim() === "") {
    return "";
  }
  if (/^(https?:|data:|blob:|\/)/i.test(src)) {
    return src;
  }
  const question = src.indexOf("?");
  if (question < 0) {
    return staticFile(src);
  }
  const path = src.slice(0, question);
  const query = src.slice(question + 1);
  return `${staticFile(path)}?${query}`;
}
