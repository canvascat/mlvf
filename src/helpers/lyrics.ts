import type { LyricLine } from "@applemusic-like-lyrics/core";
import {
  parseLrc,
  parseLys,
  parseQrc,
  parseYrc,
} from "@applemusic-like-lyrics/lyric";
import { TTMLParser, toAmllLyrics } from "@applemusic-like-lyrics/ttml";
import { DOMParser as XmlDomParser } from "@xmldom/xmldom";
import { attachQrcAnnotations } from "./qrc-aux";

export type LyricFormat = "lrc" | "ttml" | "yrc" | "qrc" | "lys";

const FORMAT_BY_EXT: Record<string, LyricFormat> = {
  ".lrc": "lrc",
  ".ttml": "ttml",
  ".yrc": "yrc",
  ".qrc": "qrc",
  ".lys": "lys",
};

function extname(filePath: string): string {
  const clean = filePath.split("?")[0] ?? filePath;
  const base = clean.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot).toLowerCase() : "";
}

export function detectLyricFormat(filePath: string): LyricFormat {
  const format = FORMAT_BY_EXT[extname(filePath)];
  if (!format) {
    throw new Error(`不支持的歌词格式: ${extname(filePath) || "(无扩展名)"}`);
  }
  return format;
}

type MappableLyricLine = {
  words: Array<{
    startTime: number;
    endTime: number;
    word: string;
    romanWord?: string;
  }>;
  startTime: number;
  endTime: number;
  translatedLyric?: string;
  romanLyric?: string;
  isBG?: boolean;
  isDuet?: boolean;
};

export function mapLyric(line: MappableLyricLine): LyricLine {
  return {
    words: line.words.map((w) => ({ ...w, obscene: false })),
    startTime: line.words[0]?.startTime ?? line.startTime ?? 0,
    endTime:
      line.words[line.words.length - 1]?.endTime ??
      line.endTime ??
      Number.POSITIVE_INFINITY,
    translatedLyric: line.translatedLyric ?? "",
    romanLyric: line.romanLyric ?? "",
    isBG: line.isBG ?? false,
    isDuet: line.isDuet ?? false,
  };
}

const QRC_TRANSLATION_MARK = "[rmv-translation]";
const QRC_ROMAN_MARK = "[rmv-roman]";

/**
 * 歌词正文后面可以用 [rmv-translation] / [rmv-roman] 带上翻译和罗马音，按时间挂回对应的歌词行。
 * QRC 用它带翻译和罗马音；LRC、YRC 只认翻译。
 */
function splitLyricBundle(raw: string): {
  main: string;
  translation: string;
  roman: string;
} {
  const transAt = raw.indexOf(QRC_TRANSLATION_MARK);
  const romanAt = raw.indexOf(QRC_ROMAN_MARK);
  const cuts = [transAt, romanAt].filter((index) => index >= 0);
  const qrcEnd = cuts.length > 0 ? Math.min(...cuts) : raw.length;
  const sliceMark = (mark: string, start: number): string => {
    if (start < 0) {
      return "";
    }
    const from = start + mark.length;
    const next = cuts.filter((index) => index > start);
    const to = next.length > 0 ? Math.min(...next) : raw.length;
    return raw.slice(from, to);
  };
  return {
    main: raw.slice(0, qrcEnd),
    translation: sliceMark(QRC_TRANSLATION_MARK, transAt),
    roman: sliceMark(QRC_ROMAN_MARK, romanAt),
  };
}

function parsedLines(raw: string, format: "lrc" | "qrc"): LyricLine[] {
  const text = raw.trim();
  if (!text) {
    return [];
  }
  const parsed = format === "lrc" ? parseLrc(text) : parseQrc(text);
  return sanitizeLyricTimestamps(parsed.map(mapLyric));
}

function extractKanaTag(qrc: string): string {
  const matches = qrc.match(/\[kana:[^\]]*\]/gi);
  return matches?.[matches.length - 1] ?? "";
}

export function parseLyricText(raw: string, format: LyricFormat): LyricLine[] {
  let lines: MappableLyricLine[];
  const bundle = splitLyricBundle(raw);
  const body = bundle.main;
  switch (format) {
    case "lrc":
      lines = parseLrc(body);
      break;
    case "yrc":
      lines = parseYrc(body);
      break;
    case "qrc":
      lines = parseQrc(body);
      break;
    case "ttml":
      lines = toAmllLyrics(
        TTMLParser.parse(body, { domParser: new XmlDomParser() }),
      ).lines;
      break;
    case "lys":
      lines = parseLys(body);
      break;
  }
  const parsed = sanitizeLyricTimestamps(lines.map(mapLyric));
  if (format === "qrc") {
    return applyDuetSections(
      attachQrcAnnotations(parsed, {
        translations: parsedLines(bundle.translation, "lrc"),
        romans: parsedLines(bundle.roman, "qrc"),
        kana: extractKanaTag(body),
      }),
    );
  }
  if (
    (format === "lrc" || format === "yrc") &&
    bundle.translation.trim()
  ) {
    return applyDuetSections(
      attachQrcAnnotations(parsed, {
        translations: parsedLines(bundle.translation, "lrc"),
        romans: [],
        kana: "",
      }),
    );
  }
  return applyDuetSections(parsed);
}

const DUET_SPEAKER =
  /^(?:男声|女声|合唱|男|女|合|方|徐)$/;

function isBlankWord(word: string): boolean {
  return word.trim().length === 0;
}

function isColonWord(word: string): boolean {
  return /^[：:]+$/.test(word.trim());
}

function speakerPrefixLength(words: LyricLine["words"]): number {
  let index = 0;
  while (index < words.length && isBlankWord(words[index]?.word ?? "")) {
    index += 1;
  }
  const token = (words[index]?.word ?? "").trim();
  const named = token.match(/^(男声|女声|合唱|男|女|合|方|徐)[：:]$/);
  if (named) {
    return index + 1;
  }
  if (!DUET_SPEAKER.test(token)) {
    return 0;
  }
  let colon = index + 1;
  while (colon < words.length && isBlankWord(words[colon]?.word ?? "")) {
    colon += 1;
  }
  if (colon < words.length && isColonWord(words[colon]?.word ?? "")) {
    return colon + 1;
  }
  return 0;
}

/**
 * 对唱行首的「方：」「徐：」「男：」「女：」「合：」只用来分段。
 * 去掉标记后，第一段靠左，之后左右交替。
 */
export function applyDuetSections(lines: readonly LyricLine[]): LyricLine[] {
  let section = 0;
  const result: LyricLine[] = [];
  for (const line of lines) {
    const prefix = speakerPrefixLength(line.words);
    const words = prefix > 0 ? line.words.slice(prefix) : line.words;
    if (prefix > 0) {
      section += 1;
    }
    const visible = words.some((word) => !isBlankWord(word.word));
    if (!visible) {
      continue;
    }
    const first = words[0];
    const last = words[words.length - 1];
    result.push({
      ...line,
      words,
      startTime: first?.startTime ?? line.startTime,
      endTime: last?.endTime ?? line.endTime,
      isDuet: section === 0 ? line.isDuet : section % 2 === 0,
    });
  }
  return result;
}

export function shiftLyricLines(
  lines: readonly LyricLine[],
  offsetMs: number,
): LyricLine[] {
  if (!offsetMs) {
    return sanitizeLyricTimestamps(lines);
  }
  return sanitizeLyricTimestamps(
    lines.map((line) => ({
      ...line,
      startTime: shiftTime(line.startTime, offsetMs),
      endTime: shiftTime(line.endTime, offsetMs),
      words: line.words.map((word) => ({
        ...word,
        startTime: shiftTime(word.startTime, offsetMs),
        endTime: shiftTime(word.endTime, offsetMs),
        ruby: word.ruby?.map((ruby) => ({
          ...ruby,
          startTime: shiftTime(ruby.startTime, offsetMs),
          endTime: shiftTime(ruby.endTime, offsetMs),
        })),
      })),
    })),
  );
}

export function sanitizeLyricTimestamps(
  lines: readonly LyricLine[],
): LyricLine[] {
  return lines.flatMap((line) => {
    const words = line.words
      .map((word) => ({
        ...word,
        startTime: clampNonNegativeTime(word.startTime),
        endTime: clampNonNegativeTime(word.endTime),
        ruby: word.ruby
          ?.map((ruby) => ({
            ...ruby,
            startTime: clampNonNegativeTime(ruby.startTime),
            endTime: clampNonNegativeTime(ruby.endTime),
          }))
          .filter((ruby) => !endedAtOrBeforeZero(ruby.endTime)),
      }))
      .filter((word) => !endedAtOrBeforeZero(word.endTime));
    const startTime = clampNonNegativeTime(line.startTime);
    const endTime = clampNonNegativeTime(line.endTime);
    if (endedAtOrBeforeZero(endTime)) {
      return [];
    }
    if (Number.isFinite(endTime) && startTime > endTime) {
      return [];
    }
    return [{ ...line, startTime, endTime, words }];
  });
}

function clampNonNegativeTime(value: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  return Math.max(0, value);
}

function endedAtOrBeforeZero(endTime: number): boolean {
  return Number.isFinite(endTime) && endTime <= 0;
}

function shiftTime(value: number, offsetMs: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  return value + offsetMs;
}

export async function loadLyricLines(
  lyricsFileUrl: string,
  abortSignal?: AbortSignal,
): Promise<LyricLine[]> {
  const response = await fetch(lyricsFileUrl, { signal: abortSignal });
  if (!response.ok) {
    throw new Error(
      `无法读取歌词文件: ${lyricsFileUrl} (${response.status})`,
    );
  }
  const raw = await response.text();
  return parseLyricText(raw, detectLyricFormat(lyricsFileUrl));
}
