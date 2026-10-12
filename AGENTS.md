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
- 两次投稿之间至少隔 180 秒。21566 是「投稿过于频繁」。
- 文件传完后检查点会被删掉。21566 之后立刻重跑会把整份文件再传一遍，先等够间隔。

合集（创建、改名、删除小节，加入或移动视频）：

- 成功的写操作之间至少隔 3 秒。0.4 秒一发时，大约每隔一次返回 256000「合集编辑过于频繁」。
- 20111 和 256000 都是编辑过于频繁。等十几秒到一分钟，重试刚才那一次，不要接着发下一条。
- 20081「已存在正片分组」和 20092「分组太多」不是限流。正片（type 1）只能有一个；小节大约 10 个就满。换 type 0，或停止新建，不要当限流重试。

Hi-Res：

- 成片音轨是无损，并且采样率不低于 96 kHz，或采样率不低于 48 kHz 且位深不低于 24 bit 时，`biliup upload` 加 `--hires 1`。
- 44.1 kHz / 16 bit 和有损音轨不要开。看封装进成片的那条音轨，不看 B 站转码后的播放流。

空间动态：

- 动态用 `biliup upload --dynamic`，内容用这一期的标题。
- 单次投稿必须带动态。
- 专辑批量串行投稿时只给其中一条带动态，写明这是整张专辑；其余稿件不要带 `--dynamic`。
