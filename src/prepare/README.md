# 备料（`src/prepare`）

给生成视频准备材料：先把目标文件和同目录相关文件（封面、已有歌词；整轨再加 CUE 引用的音频）拷到项目根目录 `预处理/<源目录名>/`，再读副本上的标签。缺歌词 / 封面 / 歌名歌手专辑时联网匹配。材料写在这份副本旁边，不改下载目录里的原文件。

整轨 CD（`.cue` + 一张 flac）不切片、不匹配歌词。封面和音频整张专辑共用，曲目只保留歌名和起止时间。导出也可以直接读 `.cue`，不必先备料。

本模块只跑在 Node（CLI / 库函数），不进 Remotion 浏览器包。

## 命令

```console
nub run _prepare -- --audio <音频或CUE>
```

脚本名叫 `_prepare`，避免 npm 的 `prepare` 生命周期。等价于 `nub src/prepare/cli.ts --audio <音频>`。

| 参数 | 说明 |
| --- | --- |
| `--audio` | 音频或 `.cue` 路径（必填） |
| `--out` | 输出目录（可选，默认是预处理副本所在目录） |
| `--title` / `--artist` / `--album` | 覆盖标签后再搜索 |
| `--lyric-offset` | 人工确认后的歌词偏移（毫秒）。不传只报告疑似值 |
| `--lyric-format` | 优先使用的歌词格式：`krc`、`ttml`、`yrc`、`qrc`、`lys`、`lrc`。没有该格式时退回默认选择。`krc` 是酷狗逐字稿，写出时仍是 `.yrc` |
| `-h` | 帮助 |

没有歌词时仍写出 json，并以非 0 退出，方便手动补歌词后再生成视频。封面缺失不算失败。

单曲还会写出同名 `.txt`。标题是「歌手《歌名》｜专辑」。简介写演唱与收录、发行日、流派、词曲编曲和制作人、音源规格、时长。词曲编曲优先读这次的歌词；歌词里没有、且歌词带 QQ 音乐 id 时再查一次，否则用标签里的作曲。发行日和流派先用音频标签，缺了再用歌词里的 Apple Music id 补。换歌词后需要重新备料，简介会跟着这次的歌词重写。

预览 / 导出只需要这份 json：

```console
nub run export -- <配置.json> --preview
nub run export -- <配置.json>
```


## 输出

先拷到 `预处理/<源目录名>/`：目标音频或 CUE，同名歌词 / 图片，以及 `cover` / `folder` / `front` 封面。整轨还会带上 CUE 引用的音频。配置和匹配结果写在同一目录，文件名与音频同名。目录里已有 `cover.jpg` 这类封面时直接引用，不再另存一张。`--out` 指向别处时才会再把音频拷到那个目录。

### 单曲

例如 `半岛铁盒.flac`：

```text
半岛铁盒.flac
半岛铁盒.ttml|yrc|lrc   # 匹配到歌词时
半岛铁盒.jpg|png|...    # 有封面时；已有同名图则直接引用
半岛铁盒.json
```

json 字段对齐 [`TrackProps`](../helpers/schema.ts)，另带 `match` 说明来源：

```json
{
  "audioFileUrl": "半岛铁盒.flac",
  "lyricsFileUrl": "半岛铁盒.ttml",
  "coverImageUrl": "半岛铁盒.jpg",
  "audioOffsetInSeconds": 0,
  "songName": "半岛铁盒",
  "artistName": "周杰伦",
  "albumName": "八度空间",
  "durationInSeconds": 319.4,
  "match": {
    "lyricSource": "amll-ttml",
    "lyricFormat": "ttml",
    "coverSource": "embedded"
  }
}
```

`lyricSource`：`embedded` | `apple-ttml` | `amll-ttml` | `netease` | `qqmusic` | `kugou` | `lrclib`  
`coverSource`：`embedded` | `netease` | `qqmusic` | `kugou` | `itunes`

### 整轨 CUE

```console
nub run _prepare -- --audio "王菲.-.1997-03-01.-.菲卖品 王菲精选.-.新艺宝.cue"
```

不切片、不复制整轨、不下载歌词。json 与音频同名。曲目只有歌名和起止时间（CUE `INDEX 01`，单位秒；最后一首的结束为整轨时长）：

```text
王菲.-.1997-03-01.-.菲卖品 王菲精选.-.新艺宝.flac
王菲.-.1997-03-01.-.菲卖品 王菲精选.-.新艺宝.jpg
王菲.-.1997-03-01.-.菲卖品 王菲精选.-.新艺宝.json
```

```json
{
  "albumName": "菲卖品 王菲精选",
  "artistName": "王菲",
  "audioFileUrl": "王菲.-.1997-03-01.-.菲卖品 王菲精选.-.新艺宝.flac",
  "coverImageUrl": "王菲.-.1997-03-01.-.菲卖品 王菲精选.-.新艺宝.jpg",
  "tracks": [
    {
      "songName": "不得了",
      "audioOffsetInSeconds": 0,
      "audioEndInSeconds": 228.427
    },
    {
      "songName": "我愿意",
      "audioOffsetInSeconds": 228.427,
      "audioEndInSeconds": 502.52
    }
  ]
}
```

播放长度是 `audioEndInSeconds - audioOffsetInSeconds`。歌名来自 CUE 曲目 TITLE；专辑名和歌手来自 CUE 专辑 TITLE / PERFORMER，没有则从 `艺人.-.日期.-.专辑.-.厂牌` 这种文件名解析。同名 `.jpg` 封面优先于音频内嵌图。预览和导出也可以跳过这份 json，直接把 `.cue` 传给 `export`。

## 本地优先

用 `music-metadata` 读文件，不把网络结果覆盖已有标签。

| 字段 | 规则 |
| --- | --- |
| 歌名 / 歌手 / 专辑 | 标签或 CLI 覆盖有则锁定；否则用最佳候选或 iTunes 补。无歌名时用文件名搜索 |
| 封面 | 同名图或目录里的 `cover` / `folder` / `front` 已有则引用；否则写出内嵌图，不再下载 |
| 时长 | 单曲用音频文件时长；CUE 曲目用 INDEX 起止，最后一首结束于整轨时长 |
| 歌词 | 标签里已有 **TTML** 才跳过搜索；内嵌 LRC/YRC 仍会联网，时长接近时 **TTML > YRC/QRC > LRC**。无时间戳的纯文本不用 |

身份、封面齐全且歌词已是 TTML 时，不再为这三项发网络请求。

## 联网匹配

缺什么补什么。歌词源并发搜索，总超时约 20s，单源失败不影响其它源。只取歌词、封面 URL、元数据，不下载音轨。Apple Music 逐字 TTML 只在已经配置了 Media-User-Token 时请求，不会另外弹出登录。

搜索词：`歌名 + 歌手`。候选用 `pickBestCandidate` / `pickBestLyric`（见 `match.ts`）：

- 硬条件：曲名全等或足够长的双向包含；双方都有时长则差距不超过 20s；有歌手时必须命中至少一个歌手
- 打分：曲名全等 +10 / 子串 +4；歌手全等 +5 / 包含 +2；专辑全等 +2；时长 ±5s +3
- 跨源：先丢掉时长差超过 20s 的候选。剩下的里 **逐字（TTML / YRC / QRC）压过整行 LRC**，即使整行更贴时长。同是逐字或同是整行时，才先比时长（差 2s 以上视为不同版本），再比格式 **TTML > YRC/QRC > LRC**，最后比分数。
- `--lyric-format` 会先只在该格式里按上面的规则挑；一份都没有，或都对不上这首歌时，退回默认选择并在终端说明。`krc` 只认酷狗解密出来的逐字稿，不认酷狗整行 LRC，也不认其它源的 YRC。

时长仍可能和这张碟对不齐（精选/不同前奏）。选出版本后会用 200–4000 Hz 人声频段的能量做成「唱没唱」包络，和这份歌词的起唱点滑动对齐，只在终端报告疑似偏移，**不写入**配置。核对预览后，用同一份歌词再跑 `--lyric-offset <毫秒>` 才会写入 `lyricOffsetMs`。偏移跟这次写出的歌词绑在一起；换了歌词必须重新备料，旧偏移不会沿用。结构完全不同的版本不会报偏移。

| 源 | 做什么 | 备注 |
| --- | --- | --- |
| 网易云 | 搜索 + lyric（优先 yrc，否则 lrc+翻译） | 命中后再试 AMLL TTML |
| QQ 音乐 | `musicu` 搜索 + 明文 lrc（旧搜索接口失败时才回退） | 命中后再试 AMLL TTML；不解密 QRC |
| 酷狗 | 搜索；逐字候选解密 KRC 并写成 YRC，否则用明文 lrc | KRC 头 4 字节后异或再 inflate |
| LRCLIB | `/api/get`（先带专辑再去掉）→ `/api/search` | 只要 synced LRC |
| AMLL TTML | `amlldb.bikonoo.com/ncm-lyrics\|qq-lyrics/{id}.ttml` | 有平台 ID 才拉 |
| Apple Music TTML | `amp-api` 的 `syllable-lyrics` | 配置了 Media-User-Token 才拉。`nub.jsonc` 的 `envFile` 指向项目根目录 `.env`，`nub` 启动时把它读进环境变量，备料只看 `MEDIA_USER_TOKEN`。`.env` 已在 git 忽略里。账号地区用 `APPLE_MUSIC_STOREFRONT`，没有就读 `/me/storefront`。搜索账号曲库以及 `cn`、`tw`、`jp`。只要带逐字时间的 TTML；专辑版只有逐行时，改用同一 ISRC 的 Single 逐字稿。开发者 token 从 `music.apple.com` 的网页播放器里取，进程内复用 |
| iTunes Search | 补封面（600×600）和仍空的身份字段 | 并行查默认店 + hk + jp；罗马音歌手名放宽匹配 |

## 库函数

CLI 只是薄封装。之后把备料从命令行提出来时：

```ts
import { lookupTrack, writeMaterials } from "../prepare";

const result = await lookupTrack({
  audioPath,
  title, // 可选，覆盖标签
  artist,
  album,
});
const { jsonPath, hasLyrics } = await writeMaterials({
  audioPath,
  result,
});
```

`lookupTrack` 返回内存中的歌信、歌词文本、封面字节；`writeMaterials` 负责落盘。

## 文件

| 文件 | 职责 |
| --- | --- |
| `cli.ts` | 参数解析与退出码 |
| `stage.ts` | 把目标文件和相关文件拷到 `预处理/` |
| `video-blurb.ts` | 用音频标签、歌词署名和发行信息写出视频标题与简介 |
| `album.ts` | 整轨 CUE 解析（时间区间、共用封面和音频）与备料 |
| `cue.ts` | 解析 CUE、定位音频和封面 |
| `lookup.ts` | 本地 + 多源编排、合并 |
| `write-materials.ts` | 写出与音频同名的 json / 歌词 / 封面 |
| `tags.ts` | 读标签 / 内嵌封面 / 带时间戳歌词 |
| `match.ts` | 归一化、时长优先选版本 |
| `lyric-offset.ts` | 歌词常量偏移估算 |
| `audio-envelope.ts` | 用 ffmpeg 读人声频段能量包络 |
| `krc.ts` | 解密酷狗 KRC，并转成 YRC |
| `lyric-quality.ts` | 格式优先级、翻译合并、解析校验 |
| `http.ts` | 超时、UA、JSON/JSONP |
| `providers/*` | 各源搜索与取词 |
| `index.ts` | 对外导出 |

## 非目标

- 不把整轨切成每首歌一个音频文件
- 不拉播放地址，也不为 Apple Music 单独做登录。Media-User-Token 放在项目根目录 `.env`，由 nub 读入
- 不解密 QQ 音乐的加密 QRC
- 不做持久缓存（只有进程内超时与失败隔离）
