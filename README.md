# mlvf

Music Lyrics Video Factory。用 Remotion 做 1920×1080 的歌词视频，Studio 里有四套画面：

- `AMLLPlayer`：一首歌。动态 Mesh 背景，左侧封面和曲目信息，右侧滚动歌词。
- `SpectraPlayer`：一首歌，换成米色频谱仪面板：封面、正在播放、实时频谱（20 Hz 到奈奎斯特，dBFS 刻度）、低频波形、曲目时间轴、当前句歌词和翻译，以及底部的采样率 / 位深 / 声道 / 格式 / 码率 / 文件大小。没有歌词时不显示歌词区。技术参数和时间轴包络在 `calculateMetadata` 里从音频文件读出，读不到的项显示 `—`。配色默认从封面自动取色（强调色取封面最鲜的主色，纸色 / 墨色跟着它的色相走，柱子和波形取互补色）；props 里传 `theme` 可以手动指定，`themeFromCover: false` 则固定用米色 + 橙色。左边默认是方形封面；`turntable: true` 换成唱机，开头唱臂落入、结束抬起，封面嵌在唱片中心。细节见 [`src/Spectra/README.md`](src/Spectra/README.md)。
- `AlbumPlayer`：一张整轨。毛玻璃封面，按时间切歌名，不滚动歌词。
- `PlaylistPlayer`：一份歌单。海报墙铺开，当前这首展开并显示当前句歌词和波形，切歌时镜头飞到下一张。

成片走导出 CLI：先做出无声画面，再用 ffmpeg 把原音轨无损 mux 进 MKV。歌单画面可以直接从网易云歌单链接导出，见下面的「网易云歌单」。

## 准备

```console
nub install
```

项目钉在 Node 26 LTS（`.node-version`）。用 `nub` 跑脚本会自动用这个版本，避免 PATH 上的其他 Node 版本混用。

系统需要能调用 `ffmpeg`（没有的话会回退到 `nubx remotion ffmpeg`）。WebGL 背景建议本机装有 Chrome。

把音频和歌词放到 `public/`。`AMLLPlayer`、`AlbumPlayer` 和 `SpectraPlayer` 默认都是 `OneLastKiss`；`PlaylistPlayer` 默认把 `OneLastKiss` 和 `周杰伦 - 半岛铁盒` 接在一起。歌词支持 `.lrc` / `.ttml` / `.yrc` / `.qrc` / `.lys`。

只有音频、缺歌词或封面时，可先备料。备料会先把音轨和同目录封面、歌词拷到项目根目录 `预处理/<源目录名>/`，再联网匹配并写出 json。单曲还会写出同名 `.txt`（视频标题和简介）。说明见 [`src/prepare/README.md`](src/prepare/README.md)。

脚本名叫 `_prepare`，避免 npm 的 `prepare` 生命周期：

```console
nub run _prepare -- --audio <音频或CUE>
```

预览和导出都只需要这份配置文件。整轨也可以跳过备料，把 `.cue` 直接交给导出。

## 网易云歌单

```console
nub run export -- "<歌单链接、分享文本或歌单ID>"
```

前提：本机已启动 `music-dl web` 并登录网易云（默认 `http://127.0.0.1:8080/music`，可用 `--server` 或环境变量 `MUSIC_DL_URL` 改）。`163cn.tv` 短链和整段分享文本都能直接传。

流程：

```text
歌单链接
    → 从 music-dl web 读出曲目（个性化推荐歌单的曲目随登录账号变化）
    → 逐首下载到 tmp/mdl/<歌单ID>/，内嵌封面和歌词；已有的跳过
    → 按歌曲 ID 取网易云歌词，整理封面，写出 tmp/mdl/<歌单ID>/export.json
    → PlaylistPlayer 渲染无声画面，每首裁到整帧后拼接原音轨
    → out/<歌单名>.mkv
```

- **歌词**：只用网易云，逐字（YRC）优先，没有逐字再用整行 LRC。
- **纯音乐**：网易云标记为纯音乐或没有歌词的歌不会去别处搜歌词，画面里只显示封面、歌名和波形。
- **翻译**：有翻译时只在当前句下面显示小字，按时间配到对应的歌词行。整理出的 `.lrc` / `.yrc` 里，歌词正文后面用 `[rmv-translation]` 带上翻译（一份 LRC），解析时按开始时间（容差 300 ms）挂回对应的歌词行，不会当成独立的歌词行。QRC 还可以用 `[rmv-roman]` 带罗马音。
- **目录**：`playlist.json` 记录歌单信息和每首歌的下载状态；`export.json` 是交给导出的配置，每次用歌单链接运行都会重写；想调某首歌的 `lyricOffsetMs`，改它之后用 `export.json --playlist` 导出。
- **失败**：下载失败的歌会从成片里跳过并列出，重跑同一条命令会补下载。

只想下载并整理素材、不渲染：

```console
nub run export -- "<歌单链接>" --prepare-only
```

之后可以直接用整理好的配置导出或预览：

```console
nub run export -- tmp/mdl/<歌单ID>/export.json --playlist
nub run export -- tmp/mdl/<歌单ID>/export.json --playlist --preview
```

重新下载音频加 `--refresh`。歌词每次运行都会重新取，不需要它；这次没取到而上次有时，会保留上次的。

## 预览

```console
nub run export -- <配置.json> --preview
```

备料目录批量预览（Studio 常开，本终端 `j`/`k` 切歌、`r` 刷新、`1-9` 跳转、`q` 退出）：

```console
nub run album-preview -- "预处理/<专辑目录名>"
```

会建临时 `public` 目录，不改仓库里的 `public/`。同时把这份配置的 props 写入 `src/helpers/studio-preview.generated.ts`，作为对应 Composition 的 `defaultProps`，Studio 右侧面板会显示并可编辑这些字段（不再用 CLI `--props`）。`npm run dev` 会清掉这份覆盖，恢复内置默认曲目。不传配置时打开默认曲目：

```console
nub run dev
```

打开 Remotion Studio 后在 Composition 里选上面三套画面。歌名、歌手、专辑、封面和时长都来自配置文件；缺时长时才从音频读取，用来决定成片长度。

## 导出

```console
nub run export -- <配置.json>
```

等价于：

```console
nub src/export/cli.ts --config <配置.json>
```

默认输出 `out/<歌名或专辑名>.mkv`。整轨还会在旁边写出同名 `.chapters.txt`（`时:分:秒 歌名`）。可选参数：

| 参数             | 说明                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `--config`       | 配置文件；也可直接作为位置参数                                                                             |
| `--out`          | 输出路径；若写成 `.mp4` 会改成 `.mkv`                                                                      |
| `--fps`          | 帧率，默认 30                                                                                              |
| `--frames`       | 只渲染部分帧，例如 `0-2`（调试）。整轨带上它会改回逐帧渲染                                                 |
| `--concurrency`  | 并行渲染路数，数字或 `50%`；默认 1 路。开太高歌词会闪                                                      |
| `--preview`      | 打开 Studio，不导出                                                                                        |
| `--background`   | AMLLPlayer 背景：`slow`（默认，一半速度）、`static`（静止）、`normal`（原来的速度）。专辑会忽略            |
| `--spectra`      | 单曲改用 `SpectraPlayer`，不能和 `--album`、`--playlist`、`.cue` 一起用                                    |
| `--album`        | 用 `AlbumPlayer`。直接传入 `.cue` 时自动开启，不需要歌词                                                   |
| `--playlist`     | 用 `PlaylistPlayer` 导出网易云歌单。传入歌单链接或 ID 时自动开启；传 `export.json` 时需要显式加上          |
| `--server`       | music-dl web 地址，只用于歌单下载                                                                          |
| `--refresh`      | 重新下载歌单音频，默认复用 `tmp/mdl/<歌单ID>` 里已有的；歌词每次都会重新取                                 |
| `--prepare-only` | 只下载并整理歌单素材、写出 `export.json`，不渲染                                                           |
| `--srt`          | 只为整轨 `.cue` 写出字幕：按曲目起点拼接，不写入偏移，并在终端列出疑似偏移。默认写在 cue 旁边的同名 `.srt` |
| `-h`             | 打印帮助                                                                                                   |

## 运行流程

单曲：

```text
配置 json
    → 相对配置目录解析音频 / 歌词 / 封面
    → 拷到临时 public 目录，生成 AMLLPlayer props
    → Remotion 渲染无声 H.264（--muted，--gl=angle，默认 1 路并行）
    → ffmpeg -c:v copy -c:a copy -shortest
    → out/<歌名>.mkv
```

整轨（`.cue`，或 json 加 `--album`）：

```text
.cue 或专辑 json
    → 解析曲目时间；封面和音频各一份
    → Remotion 每首渲一帧 AlbumPlayer 静帧
    → ffmpeg 按曲目时长把静帧铺成无声画面
    → 同一条原音轨 stream copy
    → out/<专辑名>.mkv
    → out/<专辑名>.chapters.txt
```

歌单（网易云歌单链接，或 `export.json` 加 `--playlist`）：

```text
歌单链接
    → music-dl web 读曲目，逐首下载到 tmp/mdl/<歌单ID>/（内嵌封面和歌词）
    → 按歌曲 ID 取网易云歌词和翻译，整理封面，写出 export.json
    → 拷到临时 public 目录，生成 PlaylistPlayer props（偏移和署名行在这一步处理好）
    → Remotion 渲染无声 H.264
    → 每首音轨裁到与画面相同的整帧数后拼接成一条 FLAC，再合成
    → out/<歌单名>.mkv
```

画面由 Remotion 或上面的静帧流程编码；**音轨是原文件 stream copy**（FLAC / WAV 不会被重编码）。整轨多首歌共用同一文件时也只 mux 这一条原音轨。歌单是不同的文件，需要先拼接，拼接时统一为 48 kHz 立体声 FLAC（无损，但不再是逐字节的原文件）。不要用 Studio 的 Render，那会经 Remotion 压缩音频；成片请用上面的导出命令。渲染临时文件写在项目根目录 `tmp/`（已 gitignore），结束后删除。

相关代码：

- `src/prepare/`：联网匹配歌词 / 封面 / 歌信，并写出材料包和视频简介（[文档](src/prepare/README.md)）
- `src/export/cli.ts`：入口
- `src/export/load-config.ts`：读备料 json 并解析相对路径
- `src/export/assets.ts`：准备素材和 props
- `src/export/render.ts`：Studio 预览 / Remotion 渲染 / 专辑静帧
- `src/export/mux.ts`：ffmpeg 合成
- `src/export/album-srt.ts`：整轨字幕
- `src/export/netease-playlist.ts`：解析歌单链接、读曲目、经 music-dl web 下载
- `src/export/netease-lyrics.ts`：按歌曲 ID 取网易云歌词（逐字优先，识别纯音乐）
- `src/export/playlist-materials.ts`：整理每首歌的歌词、封面，写出 `export.json`
- `src/export/playlist-pipeline.ts`：歌单链接到 `export.json` 的整条流程
- `src/Player/`：单曲画面
- `src/Album/`：整轨画面
- `src/Playlist/`：歌单海报墙

## 其他命令

```console
nub run lint
nubx remotion upgrade
```

## Docs

Remotion：[The fundamentals](https://www.remotion.dev/docs/the-fundamentals)。问题可到 [Discord](https://discord.gg/6VzzNDwUwV) 或 [GitHub Issues](https://github.com/remotion-dev/remotion/issues/new)。

## License

部分主体需要公司许可，见 [Remotion LICENSE](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md)。
