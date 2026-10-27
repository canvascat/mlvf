# Remotion styles

Style Remotion markup with the `style` prop. Studio edits inline style objects, and per-frame animation belongs on those properties.

```tsx
<AbsoluteFill
  style={{
    backgroundColor: "#111",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  }}
>
  <Interactive.Div
    name="Song name"
    style={{
      fontWeight: 500,
      opacity: 0.9,
      scale: interpolate(frame, [0, fps], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      }),
    }}
  >
    {songName}
  </Interactive.Div>
  <Img
    style={{ width: "100%", height: "100%", objectFit: "cover" }}
    src={src}
  />
</AbsoluteFill>
```

- On `Interactive.*`, pass a plain object: inline values, no extracted style objects, spreads, or constants.
- Animate with inline `interpolate()` on `scale`, `translate`, and `rotate`.
- CSS `transition`, `animation`, and Tailwind `animate-*` / `transition-*` classes do not render frame by frame.
- Library DOM nodes get the same declarations via `element.style`.
- A CSS variable a library reads can live on `style`, for example `"--amll-lp-font-size"`.

# biliup 投稿

用 biliup 投稿，或用同一套登录态调用 `member.bilibili.com` 的合集接口时，写操作要留间隔。下一条请求等上一条成功后再发，不要并行，也不要在失败后立刻重试。

投稿：

- `biliup upload` 必须 `--submit web`。不带 `--submit` 会走 App 投稿，更容易触发 21566。
- 两次投稿之间至少隔 180 秒。21566 和 137022 都是「投稿过于频繁」。判断时只把这两个码当成独立数字，文件大小里可能夹着同样的数字。
- 文件传完后检查点会被删掉。21566 之后立刻重跑 `biliup upload` 会把整份文件再传一遍。
- 批量新投稿已经隔了 180 秒，提交仍返回 21566、137022 或「投稿过于频繁」时，从这一条起改存草稿。覆盖已有稿件不走草稿，草稿不会替换原来的 BV。

合集（创建、改名、删除小节，加入或移动视频）：

- 成功的写操作之间至少隔 3 秒。0.4 秒一发时，大约每隔一次返回 256000「合集编辑过于频繁」。
- 20111 和 256000 都是编辑过于频繁。等十几秒到一分钟，重试刚才那一次，不要接着发下一条。
- 20081「已存在正片分组」和 20092「分组太多」不是限流。正片（type 1）只能有一个；小节大约 10 个就满。换 type 0，或停止新建，不要当限流重试。

Hi-Res：

- 成片音轨是无损，并且采样率不低于 96 kHz，或采样率不低于 48 kHz 且位深不低于 24 bit 时，`biliup upload` 加 `--hires 1`。
- 44.1 kHz / 16 bit 和有损音轨不要开。看封装进成片的那条音轨，不看 B 站转码后的播放流。

投稿封面：

- 投稿封面从成片抽一帧。jpg 放在成片旁边，文件名与成片相同，`upload.cover` 指这张图。备料目录里的专辑图只用于视频画面。
- 有歌词时，用 `nub tmp/lyric-cover-time.ts <歌词> <歌名> <歌手>` 取秒数。它丢掉背景行、不足 4 个字的行、词曲编曲署名，以及同时带歌手和歌名的行。优先用包含歌名、并且比歌名更长的句子，有多句时取得最长的一句；没有就用至少重复两次、次数最多的一句。时间取这句最后一个字出现后再 200 毫秒，并且不晚于这句结束前 80 毫秒。
- 抽帧：`ffmpeg -y -ss <秒> -i <成片.mkv> -frames:v 1 -update 1 -q:v 2 <封面.jpg>`。
- 没有歌词时，抽成片第 2 秒。

空间动态：

- 动态用 `biliup upload --dynamic`，内容用这一期的标题。
- 单次投稿必须带动态。
- 专辑批量串行投稿时只给其中一条带动态，写明这是整张专辑；其余稿件不要带 `--dynamic`。

成片先入队：

- 视频做完后，用户没有明确说现在上传，就不要投稿。把待传条目写入 `tmp/upload-queue.json`，做完告诉用户已入队、会在空闲时再传。
- 用户明确说现在上传、马上投稿或传上去时，立刻按队列传，不必等空闲。
- 用户明确说不要上传时，不入队，也不传。
- 同一条成片已在队列里且 `status` 仍是 `pending` 时，更新原来那条，不要再加一条。用成片路径区分；覆盖已有稿件时也可以用 `bvid` 区分。

空闲再传：

- 满足任一条件再开始投稿：本地时间在凌晨 00:00–05:59，或屏幕已连续锁定满 10 分钟。
- 锁屏看 `ioreg -n Root -d1` 里有没有 `CGSSessionScreenIsLocked` 且值为 `Yes`。没有这一项就是未锁定。第一次发现锁定只把 `locked_since` 写成当时的时间，先不传。下次仍锁定且距 `locked_since` 已满 10 分钟再传。解锁后把 `locked_since` 清成 `null`。
- 空闲时先发布草稿箱里的稿件，再传队列里 `status` 为 `pending` 的条目。队列里 `draft` 的按 `created` 先后发，接着发草稿箱里队列没有记下的。发布某一条草稿时如果再次返回投稿过于频繁，这次空闲就停，剩下的草稿留在草稿箱，`pending` 也不要接着传。
- 一次只传一条。上一条成功后再等至少 180 秒。新投稿在这个间隔之后仍返回投稿过于频繁，按下面的草稿规则处理。覆盖已有稿件遇到 21566 先等够间隔，重试刚才那一次；遇到 137022 时把 `hold_until` 写成次日 00:00，剩下的覆盖留在队列里，并告诉用户。`hold_until` 还没到时不要开传。

两种投稿，写在条目的 `mode` 里：

- `first`：没有已有稿件。用 `biliup upload --submit web` 新投。标题、简介、标签、封面、分区、版权、动态、Hi-Res 写在 `upload` 里。专辑批量只给其中一条写 `dynamic`。知道要进的合集小节时，把 `season_id` 和 `section_id` 一并写上，投稿成功后再加入合集。
- `overwrite`：覆盖已有稿件，必须带 `bvid`。先 `biliup append --submit web --vid <bvid>` 把成片追加成分 P，再用 `member.bilibili.com/x/vu/web/edit` 只留下新的分 P，分 P 标题沿用原来的，稿件号不变。不要另外 `upload` 出一条新稿。

草稿：

- `biliup` 没有草稿子命令。写入前先 `GET https://member.bilibili.com/x/vupre/web/draft/list?pn=1&ps=30`，`data` 是草稿数组。草稿箱最多 30 条，空位是 `30 - 已有条数`。空位为 0 时一条都不存，告诉用户草稿箱已满，剩下的留在队列。能存的只存空位那么多，多出来的留在队列并说明差几条。不要删已有草稿腾位置。
- 存草稿用 `POST https://member.bilibili.com/x/vupre/web/draft/add?csrf=`，正文与 Web 投稿相同的 JSON，登录态用 `~/.config/biliup/cookies.json`。这次上传已经拿到 `filename` 和 `cid` 时直接写进 `videos`，不要把文件再传一遍。没拿到才重新上传。
- 一条一条存，上一条成功后再存下一条，至少隔 3 秒。草稿接口自己也返回投稿过于频繁时停下，剩下的留在队列。
- 成功后把队列 `status` 写成 `draft`，记下 `draft_id`。刚存进草稿的，同一次批量里不要接着发布。用户明确说现在发布草稿时，不必等空闲。
- 发布草稿先 `GET https://member.bilibili.com/x/vupre/web/draft/view?id=<draft_id>`，用返回的 `videos`（已有 `filename` 和 `cid`）走 `POST https://member.bilibili.com/x/vu/web/add/v3?csrf=`，不要把文件再传一遍。队列条目上的动态、合集按正式投稿的规则补上；专辑批量仍然只给其中一条发动态。成功并拿到 BV 后，`POST https://member.bilibili.com/x/vupre/web/draft/delete?csrf=` 删掉这条草稿，队列写成 `done`，写上 `finished` 和稿件号。删除失败时告诉用户，不要再发一次。

队列文件不存在时建成 `{ "locked_since": null, "hold_until": null, "items": [] }`。每条至少有 `id`、`mode`、`status`、`video`、`title`、`created`。`status` 用 `pending`、`draft` 或 `done`。正式投稿完成写成 `done`，并写上 `finished` 和稿件号。存进草稿箱写成 `draft`，并写上 `draft_id`。
