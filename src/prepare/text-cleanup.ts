import { toSimplified } from "./traditional-to-simplified";

export { toSimplified };

const KANA = /[\u3040-\u30ff\u31f0-\u31ff]/;

/** 标签里偶发把 GBK 歌手名按 Latin-1 读出，例如「周杰伦」变成「ÖÜ½ÜÂ×」。已有汉字则不动。 */
export function repairLegacyChinese(value: string): string {
  const text = value.trim();
  if (!text || /[\u3400-\u9fff]/.test(text)) {
    return text;
  }
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code > 0xff) {
      return text;
    }
    bytes.push(code);
  }
  if (!bytes.some((byte) => byte >= 0x80)) {
    return text;
  }
  const decoded = new TextDecoder("gb18030").decode(Uint8Array.from(bytes));
  if (/[\u3400-\u9fff]/.test(decoded) && !decoded.includes("\uFFFD")) {
    return decoded;
  }
  return text;
}

/**
 * 先还原乱码。没有平假名或片假名时再繁转简。
 * 带假名的日文保持原文，避免把「負けないで」收成「负けないで」。
 */
export function prepareDisplayText(value: string): string {
  const repaired = repairLegacyChinese(value);
  if (!repaired || KANA.test(repaired)) {
    return repaired;
  }
  return toSimplified(repaired);
}

/** QQ 的假名注音坏掉时会在括号外连着写多位数字，例如 `1ま11111し`。这种行整行丢掉。 */
export function kanaTagIsCorrupt(line: string): boolean {
  const trimmed = line.trim();
  if (!/^\[kana:/i.test(trimmed)) {
    return false;
  }
  const outsideTimes = trimmed.replace(/\([^)]*\)/g, "");
  return /\d{2,}/.test(outsideTimes);
}

export function sanitizeLyric(content: string): string {
  return content
    .split(/\r?\n/)
    .filter((line) => !kanaTagIsCorrupt(line))
    .map((line) => prepareDisplayText(line))
    .join("\n");
}
