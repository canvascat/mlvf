import type { LyricLine } from "@applemusic-like-lyrics/core";
import {
  creditLabel,
  labelSuggestsCredit,
  lineLyricText,
  stripLyricMetadata,
} from "./lyric-metadata";

const COPYRIGHT = /版权声明|著作权/;

// 冒号左边像职务，或整行是版权声明。对白和钟点的左边不是职务。
export function isSuspectedEdgeCreditLine(text: string): boolean {
  if (COPYRIGHT.test(text)) {
    return true;
  }
  const label = creditLabel(text);
  return Boolean(label && labelSuggestsCredit(label.key));
}

export function findSuspectedEdgeCredits(
  lines: readonly LyricLine[],
  meta?: { title?: string; artists?: string | readonly string[] },
): string[] {
  const texts = stripLyricMetadata(lines, meta).map(lineLyricText);
  const head: string[] = [];
  let index = 0;
  while (index < texts.length) {
    const text = texts[index] ?? "";
    if (!text) {
      index += 1;
      continue;
    }
    if (!isSuspectedEdgeCreditLine(text)) {
      break;
    }
    head.push(text);
    index += 1;
  }
  const tail: string[] = [];
  let end = texts.length - 1;
  while (end >= index) {
    const text = texts[end] ?? "";
    if (!text) {
      end -= 1;
      continue;
    }
    if (!isSuspectedEdgeCreditLine(text)) {
      break;
    }
    tail.push(text);
    end -= 1;
  }
  tail.reverse();
  return [...head, ...tail];
}

export function formatEdgeCreditReport(songName: string, lines: readonly string[]): string {
  if (lines.length === 0) {
    return "";
  }
  return [
    `疑似无效歌词行（《${songName}》），未加入默认规则：`,
    ...lines.map((line) => `  ${line}`),
    "确认是署名后：nub run _prepare -- --audio <音频> --accept-edge-credits",
  ].join("\n");
}
