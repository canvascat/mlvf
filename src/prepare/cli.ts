import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { prepareCueAlbum } from "./album";
import { isCuePath } from "./cue";
import { lookupTrack } from "./lookup";
import { parseLyricFormatPreference, type LyricFormatPreference } from "./match";
import { stagePrepareInput } from "./stage";
import { isAlac, transcodeAlacToFlac } from "./transcode";
import { writeVideoBlurb } from "./video-blurb";
import { writeMaterials } from "./write-materials";

class UsageError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "UsageError";
    this.exitCode = exitCode;
  }
}

const USAGE = `用法: nub run prepare -- --audio <音频或CUE> [--out <目录>] [选项]

根据音频标签联网匹配歌词、封面和歌名/歌手/专辑。
整轨 CUE 只解析曲目时间，不匹配歌词；封面和音频整张专辑共用。

先把目标文件和同目录的封面、歌词拷到项目根目录的「预处理/<源目录名>/」，再在副本上写出材料。
可用 --out 改写出位置。配置与音频同名。

单曲写出:
  <歌曲>.json  <歌曲>.<歌词格式>  <歌曲>.<图>

整轨 CUE 写出（同一音频、同一封面，曲目只有起止时间）:
  <专辑音频>.json

必填:
  --audio   音频或 .cue 路径

可选:
  --out     输出目录（默认是预处理副本所在目录）
  --title   覆盖歌名后再搜索（单曲）
  --artist  覆盖艺术家
  --album   覆盖专辑名
  --lyric-offset  核对后确认的歌词偏移（毫秒）。不传则只报告疑似值，不写入
  --lyric-format  优先使用的歌词格式：krc、ttml、yrc、qrc、lys、lrc。没有该格式时退回默认选择。krc 是酷狗逐字稿，写出时仍是 yrc
  -h, --help
`;

type PrepareArgs = {
  audio: string;
  out?: string;
  title?: string;
  artist?: string;
  album?: string;
  lyricOffset?: number;
  lyricFormat?: LyricFormatPreference;
};

function parsePrepareArgs(argv: string[]): PrepareArgs {
  const args = argv.filter((arg) => arg !== "--");
  let values: {
    audio?: string;
    out?: string;
    title?: string;
    artist?: string;
    album?: string;
    "lyric-offset"?: string;
    "lyric-format"?: string;
    help?: boolean;
  };

  try {
    ({ values } = parseArgs({
      args,
      options: {
        audio: { type: "string" },
        out: { type: "string" },
        title: { type: "string" },
        artist: { type: "string" },
        album: { type: "string" },
        "lyric-offset": { type: "string" },
        "lyric-format": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: false,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`${message}\n\n${USAGE}`);
  }

  if (values.help) {
    throw new UsageError(USAGE, 0);
  }
  if (!values.audio) {
    throw new UsageError(`需要 --audio\n\n${USAGE}`);
  }

  let lyricOffset: number | undefined;
  if (values["lyric-offset"] !== undefined) {
    lyricOffset = Number(values["lyric-offset"]);
    if (!Number.isFinite(lyricOffset)) {
      throw new UsageError(`--lyric-offset 需要毫秒数\n\n${USAGE}`);
    }
  }

  let lyricFormat: LyricFormatPreference | undefined;
  if (values["lyric-format"] !== undefined) {
    try {
      lyricFormat = parseLyricFormatPreference(values["lyric-format"]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new UsageError(`${message}\n\n${USAGE}`);
    }
  }

  return {
    audio: values.audio,
    out: values.out,
    title: values.title,
    artist: values.artist,
    album: values.album,
    lyricOffset,
    lyricFormat,
  };
}

function resolveInput(audio: string): string {
  const resolved = path.resolve(audio);
  if (!existsSync(resolved)) {
    throw new UsageError(`找不到文件: ${resolved}`);
  }
  if (statSync(resolved).isDirectory()) {
    throw new UsageError(`请传入 .cue 或音频文件，而不是目录: ${resolved}`);
  }
  return resolved;
}

async function main() {
  try {
    const args = parsePrepareArgs(process.argv.slice(2));
    const inputPath = resolveInput(args.audio);
    const staged = await stagePrepareInput(inputPath);
    console.log(`已拷贝到 ${staged.dir}`);
    const outDir = path.resolve(args.out ?? staged.dir);

    if (isCuePath(inputPath)) {
      if (args.lyricFormat) {
        console.log("整轨不匹配歌词，已忽略 --lyric-format");
      }
      const { jsonPath, trackCount } = await prepareCueAlbum({
        cuePath: staged.inputPath,
        outDir,
        album: args.album,
        artist: args.artist,
      });
      console.log(`已写出 ${jsonPath}（${trackCount} 首，共用同一音频和封面）`);
      return;
    }

    let audioPath = staged.inputPath;
    let convertedFromAlac = false;
    if (await isAlac(audioPath)) {
      console.log("ALAC 浏览器无法解码，正在无损转成 FLAC…");
      audioPath = await transcodeAlacToFlac(audioPath);
      convertedFromAlac = true;
      console.log(`已转码 ${audioPath}`);
    }

    const result = await lookupTrack({
      audioPath,
      title: args.title,
      artist: args.artist,
      album: args.album,
      lyricFormat: args.lyricFormat,
    });
    const { jsonPath, prepared, hasLyrics } = await writeMaterials({
      audioPath,
      outDir,
      result,
      lyricOffsetMs: args.lyricOffset,
    });

    console.log(`已写出 ${jsonPath}`);
    console.log(
      `${prepared.songName} / ${prepared.artistName} / ${prepared.albumName}`,
    );
    const usedPreferredFormat =
      args.lyricFormat === "krc"
        ? prepared.match.lyricSource === "kugou" &&
          prepared.match.lyricFormat === "yrc"
        : Boolean(
            args.lyricFormat &&
              prepared.match.lyricFormat === args.lyricFormat,
          );
    console.log(
      `歌词: ${prepared.match.lyricSource ?? "无"} ${prepared.match.lyricFormat ?? ""}${usedPreferredFormat ? `（优先 ${args.lyricFormat}）` : ""}`.trim(),
    );
    console.log(`封面: ${prepared.match.coverSource ?? "无"}`);
    if (args.lyricOffset !== undefined) {
      console.log(`已写入歌词偏移: ${args.lyricOffset}ms（仅对这次的歌词）`);
    } else if (result.suspectedLyricOffsetMs) {
      console.log(
        `疑似歌词偏移 ${result.suspectedLyricOffsetMs}ms，未写入。核对后：nub run _prepare -- --audio <音频> --lyric-offset ${result.suspectedLyricOffsetMs}`,
      );
    }

    const blurb = await writeVideoBlurb({
      audioPath,
      overrides: {
        title: args.title,
        artist: args.artist,
        album: args.album,
      },
      convertedFromAlac,
      lyricPath: prepared.lyricsFileUrl
        ? path.join(outDir, prepared.lyricsFileUrl)
        : undefined,
      outDir,
    });
    console.log(`已写出 ${blurb.textPath}`);
    console.log(`标题: ${blurb.blurb.title}`);
    console.log(blurb.blurb.description);

    if (!hasLyrics) {
      throw new UsageError(
        "未匹配到可用歌词，已写出配置，可手动补同名歌词后再生成视频",
      );
    }
  } catch (error) {
    if (error instanceof UsageError) {
      const stream = error.exitCode === 0 ? console.log : console.error;
      stream(error.message);
      process.exit(error.exitCode);
    }
    console.error(
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    process.exit(1);
  }
}

void main();
