import type { LyricLine } from "@applemusic-like-lyrics/core";

const CREDIT_KEYWORDS = [
  "词",
  "詞",
  "曲",
  "词曲",
  "詞曲",
  "作词",
  "作詞",
  "作曲",
  "编曲",
  "編曲",
  "制作",
  "製作",
  "制作人",
  "製作人",
  "原唱",
  "原曲",
  "监制",
  "監製",
  "混音",
  "录音",
  "錄音",
  "母带",
  "母帶",
  "出品",
  "发行",
  "發行",
  "翻唱",
  "lyricist",
  "composer",
  "arranger",
  "producer",
  "lyrics",
  "arrangedby",
  "producedby",
  "composedby",
  "lyricsby",
  "writtenby",
] as const;

const CREDIT_REGEXES = [
  /^纯音乐，请欣赏$/,
  /^此歌曲为没有填词的纯音乐，请您欣赏$/,
  /未经(?:授权|许可)/,
] as const;

const NO_COLON_SEPARATORS = new Set([
  ":",
  ",",
  ".",
  "!",
  "-",
  "_",
  "(",
  "[",
  "{",
  "【",
  "『",
  "「",
  "。",
  "·",
]);

const KEYWORD_SET = new Set(CREDIT_KEYWORDS.map(normalizeCredit));

const ROLE_ATOMS = [
  "背景人声",
  "作词",
  "作詞",
  "作曲",
  "编曲",
  "編曲",
  "填词",
  "填詞",
  "词曲",
  "詞曲",
  "制作人",
  "製作人",
  "制作",
  "製作",
  "监制",
  "監製",
  "出品",
  "发行",
  "發行",
  "原唱",
  "原曲",
  "翻唱",
  "配唱",
  "主唱",
  "副唱",
  "和声",
  "和聲",
  "合声",
  "合聲",
  "合唱",
  "和音",
  "伴唱",
  "伴奏",
  "人声",
  "人聲",
  "女声",
  "男声",
  "小提琴",
  "中提琴",
  "大提琴",
  "手风琴",
  "手風琴",
  "电子琴",
  "電子琴",
  "打击乐",
  "打擊樂",
  "合成器",
  "萨克斯",
  "长笛",
  "吉他",
  "贝斯",
  "贝司",
  "貝斯",
  "钢琴",
  "鋼琴",
  "键盘",
  "鍵盤",
  "弦乐",
  "弦樂",
  "口琴",
  "二胡",
  "琵琶",
  "古筝",
  "古箏",
  "笛子",
  "乐器",
  "樂器",
  "编辑",
  "編輯",
  "处理",
  "處理",
  "唢呐",
  "嗩吶",
  "竖琴",
  "豎琴",
  "风琴",
  "風琴",
  "录音",
  "錄音",
  "混音",
  "母带",
  "母帶",
  "编程",
  "編程",
  "编写",
  "編寫",
  "工程",
  "助理",
  "重奏",
  "作者",
  "指挥",
  "指揮",
  "乐团",
  "樂團",
  "乐队",
  "樂隊",
  "lyricist",
  "composer",
  "arranger",
  "producer",
  "programmer",
  "engineer",
  "recording",
  "keyboards",
  "keyboard",
  "percussion",
  "strings",
  "mixing",
  "studio",
  "vocals",
  "violin",
  "guitar",
  "chorus",
  "scratch",
  "cello",
  "viola",
  "piano",
  "vocal",
  "drums",
  "synth",
  "bass",
  "drum",
  "词",
  "詞",
  "曲",
  "师",
  "師",
  "室",
  "鼓",
  "op",
  "sp",
].sort((left, right) => right.length - left.length || left.localeCompare(right));

const ROLE_MODIFIERS = [
  "执行",
  "联合",
  "聯合",
  "所有",
  "数字",
  "數字",
  "后期",
  "後期",
  "首席",
  "客座",
  "前奏",
  "间奏",
  "間奏",
  "尾奏",
  "过带",
  "過帶",
  "总",
  "總",
  "副",
  "原",
  "主",
  "双",
  "雙",
  "电",
  "電",
  "木",
  "一",
  "二",
  "三",
  "四",
  "五",
  "六",
  "七",
  "八",
  "九",
  "十",
];

const ROLE_JOINERS = ["and", "和", "与", "與", "及"];

const SPOKEN = /[我你他她它的了吗呢吧啊不没爱在是有这那就都也还会要想说把被让给与和又很太最]/;

function normalizeCredit(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

function unwrapBrackets(text: string): string {
  let processed = text.trim();
  const pairs = [
    ["(", ")"],
    ["（", "）"],
    ["【", "】"],
    ["[", "]"],
    ["{", "}"],
    ["『", "』"],
    ["「", "」"],
  ] as const;
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (const [open, close] of pairs) {
      if (!processed.startsWith(open)) {
        continue;
      }
      if (processed.endsWith(close)) {
        processed = processed.slice(open.length, -close.length).trim();
        changed = true;
        break;
      }
    }
    if (!changed) {
      break;
    }
  }
  return processed;
}

export function lineLyricText(line: LyricLine): string {
  return line.words.map((word) => word.word).join("").trim();
}

export function isLyricMetadataLine(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (CREDIT_REGEXES.some((pattern) => pattern.test(trimmed))) {
    return true;
  }
  const cleaned = unwrapBrackets(trimmed);
  const colon = /[:：]/.exec(cleaned);
  if (colon) {
    const key = normalizeCredit(unwrapBrackets(cleaned.slice(0, colon.index)));
    if (!key) {
      return false;
    }
    if (KEYWORD_SET.has(key) || isCreditRoleKey(key)) {
      return true;
    }
    for (const keyword of KEYWORD_SET) {
      if (!key.startsWith(keyword)) {
        continue;
      }
      const next = key[keyword.length];
      if (
        next === "/" ||
        next === "&" ||
        next === "、" ||
        next === "+" ||
        (next !== undefined && next >= "a" && next <= "z")
      ) {
        return true;
      }
    }
    return false;
  }

  const normalized = normalizeCredit(cleaned);
  if (normalized.length >= 2 && KEYWORD_SET.has(normalized)) {
    return true;
  }
  for (const keyword of KEYWORD_SET) {
    if (keyword.length < 2 || !normalized.startsWith(keyword)) {
      continue;
    }
    const next = normalized[keyword.length];
    if (next && NO_COLON_SEPARATORS.has(next)) {
      return true;
    }
  }
  return false;
}

function isCreditRoleKey(raw: string): boolean {
  let rest = normalizeCredit(raw).replace(/[/&+、._-]/g, "");
  if (!rest) {
    return false;
  }
  let sawAtom = false;
  while (rest) {
    if (sawAtom && /^[手组組]/.test(rest)) {
      rest = rest.slice(1);
      continue;
    }
    const ordinal = /^(?:\d+(?:st|nd|rd|th)?)/.exec(rest);
    if (ordinal && ordinal[0].length < rest.length) {
      rest = rest.slice(ordinal[0].length);
      continue;
    }
    const atom = ROLE_ATOMS.find((item) => rest.startsWith(item));
    if (atom) {
      sawAtom = true;
      rest = rest.slice(atom.length);
      continue;
    }
    const modifier = ROLE_MODIFIERS.find((item) => rest.startsWith(item));
    if (modifier) {
      rest = rest.slice(modifier.length);
      continue;
    }
    const joiner = sawAtom
      ? ROLE_JOINERS.find((item) => rest.startsWith(item))
      : undefined;
    if (joiner && rest.length > joiner.length) {
      rest = rest.slice(joiner.length);
      continue;
    }
    return false;
  }
  return sawAtom;
}

function splitLabel(text: string): { key: string; value: string } | null {
  const cleaned = unwrapBrackets(text.trim());
  const colon = /[:：]/.exec(cleaned);
  if (!colon || colon.index <= 0) {
    return null;
  }
  const key = cleaned.slice(0, colon.index).trim();
  const value = cleaned.slice(colon.index + 1).trim();
  if (!key || !value) {
    return null;
  }
  return { key, value };
}

function isPersonName(value: string): boolean {
  const text = value.replace(/[（(][^）)]*[）)]/g, "").trim();
  if (!text || SPOKEN.test(text)) {
    return false;
  }
  const parts = text.split(/\s*[/、&+,，]\s*/).filter(Boolean);
  if (parts.length === 0) {
    return false;
  }
  return parts.every((part) => {
    if (/^[\u4e00-\u9fff]{2,4}$/.test(part)) {
      return true;
    }
    const words = part.split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > 6) {
      return false;
    }
    return words.every((word) => {
      if (/^(?:of|the|and|for|by)$/i.test(word)) {
        return true;
      }
      if (/^[A-Z][A-Z0-9.'’+-]*$/.test(word)) {
        return true;
      }
      return /^[A-Z][a-zA-Z0-9.'’+-]*$/.test(word);
    });
  });
}

function isEdgeAttribution(text: string): boolean {
  const parts = splitLabel(text);
  if (!parts) {
    return false;
  }
  const key = normalizeCredit(parts.key);
  if (key.length < 4 || SPOKEN.test(key) || isCreditRoleKey(key)) {
    return false;
  }
  return isPersonName(parts.value);
}

function looksLikeTitleLine(text: string): boolean {
  const trimmed = unwrapBrackets(text.trim());
  if (!trimmed || trimmed.length > 60 || /[:：]/.test(trimmed)) {
    return false;
  }
  return /^.{1,40}\s*[-–—－]\s*.{1,40}$/.test(trimmed);
}

function isLeadingTitleLine(text: string, index: number, texts: readonly string[]): boolean {
  if (!looksLikeTitleLine(text)) {
    return false;
  }
  for (let next = index + 1; next < texts.length && next < index + 12; next++) {
    const line = texts[next] ?? "";
    if (!line) {
      continue;
    }
    if (isLyricMetadataLine(line) || looksLikeTitleLine(line)) {
      return true;
    }
    return false;
  }
  return false;
}

function peelEdgeCredits(texts: readonly string[], excluded: Set<number>, step: 1 | -1) {
  const start = step === 1 ? 0 : texts.length - 1;
  for (let index = start; index >= 0 && index < texts.length; index += step) {
    const text = texts[index] ?? "";
    if (!text || excluded.has(index)) {
      continue;
    }
    if (isEdgeAttribution(text) || (step === 1 && isLeadingTitleLine(text, index, texts))) {
      excluded.add(index);
      continue;
    }
    break;
  }
}

function splitArtists(artists: string | readonly string[]): string[] {
  const values = typeof artists === "string" ? [artists] : artists;
  return values
    .flatMap((artist) => artist.split(/[、&;，,/|·・]+/g))
    .map((artist) => artist.trim())
    .filter((artist) => artist.length >= 1);
}

export function stripLyricMetadata(
  lines: readonly LyricLine[],
  meta?: { title?: string; artists?: string | readonly string[] },
): LyricLine[] {
  if (lines.length === 0) {
    return [];
  }
  const texts = lines.map(lineLyricText);
  const excluded = new Set<number>();
  for (let index = 0; index < lines.length; index++) {
    const text = texts[index] ?? "";
    if (text && isLyricMetadataLine(text)) {
      excluded.add(index);
    }
  }

  const title = meta?.title?.trim().toLowerCase();
  const artists = splitArtists(meta?.artists ?? [])
    .map((artist) => artist.toLowerCase())
    .filter((artist) => artist.length >= 1);
  if (title && artists.length > 0) {
    let scanned = 0;
    for (let index = 0; index < lines.length && scanned < 5; index++) {
      if (excluded.has(index)) {
        continue;
      }
      const text = (texts[index] ?? "").toLowerCase();
      if (!text) {
        continue;
      }
      scanned += 1;
      if (
        text.includes(title) &&
        artists.some((artist) => text.includes(artist))
      ) {
        excluded.add(index);
      }
    }
  }

  peelEdgeCredits(texts, excluded, 1);
  peelEdgeCredits(texts, excluded, -1);

  let first = -1;
  for (let index = 0; index < lines.length; index++) {
    if (excluded.has(index) || !(texts[index] ?? "")) {
      continue;
    }
    first = index;
    break;
  }
  if (first === -1) {
    return [];
  }
  let last = first;
  for (let index = lines.length - 1; index >= first; index--) {
    if (excluded.has(index) || !(texts[index] ?? "")) {
      continue;
    }
    last = index;
    break;
  }
  return lines.filter((_, index) => index >= first && index <= last && !excluded.has(index));
}
