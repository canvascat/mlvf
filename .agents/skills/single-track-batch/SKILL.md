---
name: single-track-batch
description: 把分轨专辑文件夹备料成单曲，并串行导出歌词视频。用户给出专辑目录并说预处理、做成单曲视频、要预览命令或串行导出时使用。不要用于整轨 CUE 专辑视频。
---

# 分轨专辑单曲批量

目标是文件夹里的每首分轨各做一条单曲视频。在仓库根目录执行。当前 shell 是 zsh，不要用 bash 的 `mapfile`。

不要改下载目录里的原文件。备料写到 `预处理/<源目录名>/`。成片写到 `out/<源目录名>/<歌手>-<歌名>.mkv`。

## 先分清目录

列出目录再动手。

- 多首音频（`.flac` / `.wav` / `.mp3` 等）加封面：按下面的单曲流程。
- 一份 `.cue` 加一条整轨：这是专辑视频，不要用本技能，不要把整轨切成单曲。

## 备料

用户说预处理时直接跑，先不要导出。一首接一首，只开一个 shell。

```zsh
album="<专辑目录>"
ok=0
fail=0
setopt NULL_GLOB
for f in "$album"/*.(flac|wav|mp3|m4a|aac)(N); do
  echo "========== $(basename "$f") =========="
  if nub run _prepare -- --audio "$f"; then
    ok=$((ok + 1))
  else
    echo "FAILED: $(basename "$f")"
    fail=$((fail + 1))
  fi
done
echo "DONE ok=$ok fail=$fail"
```

缺歌词时该首以非 0 退出，配置仍会写出。继续后面的曲目，最后点名失败的歌。

跑完后读每份 json 的 `songName`、`artistName`、`match.lyricFormat`、`match.lyricSource`，用表格汇报。终端里的「疑似歌词偏移」只报告，不要加 `--lyric-offset`。用户核对预览并确认毫秒数之后，才对那一首重跑备料并带上 `--lyric-offset`。

## 预览命令

用户要预览命令时，列出该目录下每份 json，不要替用户启动。一条一首：

```console
nub run export -- "预处理/<源目录名>/<音频主名>.json" --preview
```

## 导出

用户要导出命令时，打印命令并停下。用户明确说执行时才跑。

规则：

- 不传 `--concurrency`。默认 1 路。大于 1 时，歌词播放器靠 `requestAnimationFrame` 的时间差推进，多标签同时截帧，成片会闪。
- 同一时间只跑一个 `nub run export`。导出前先看终端，已有导出就不要再开。
- 用 `&&` 串成一条命令。前一首成功才开始下一首，某一首失败则停住。
- 不要加 `--album`。

```console
mkdir -p "out/<源目录名>" && \
nub run export -- "预处理/<源目录名>/01 歌名.json" --out "out/<源目录名>/<歌手>-<歌名>.mkv" && \
nub run export -- "预处理/<源目录名>/02 歌名.json" --out "out/<源目录名>/<歌手>-<歌名>.mkv"
```

`<歌手>` 和 `<歌名>` 用 json 里的 `artistName`、`songName`。已有成片且用户没说重导，就从缺的那首接着串。用户说画面有问题或要重导，再覆盖已有文件。

## 导出之后

成片写完按 `AGENTS.md` 的投稿队列处理。用户这次没有明确说现在上传，就把每条写入 `tmp/upload-queue.json`，先不投稿。已有稿件号的记 `mode: overwrite` 并写上 `bvid`；没有稿件号的记 `mode: first`，并把投稿用的标题、简介、标签、封面、分区、版权和动态写进 `upload`。
