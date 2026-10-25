import {
  LayoutReason,
  LyricPlayer,
  type LyricLine,
} from "@applemusic-like-lyrics/core";
import type { CSSProperties, FC } from "react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { getRemotionEnvironment, useCurrentFrame, useVideoConfig } from "remotion";
import { isLyricTimeSeek } from "./lyric-clock";

export const Lyrics: FC<{
  lyricLines: LyricLine[];
  alignPosition: number;
  style?: CSSProperties;
}> = ({ lyricLines, alignPosition, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTimeMs = Math.floor((frame / fps) * 1000);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const corePlayerRef = useRef<LyricPlayer | null>(null);
  const currentTimeRef = useRef(currentTimeMs);
  const prevLyricLinesRef = useRef(lyricLines);
  const rendererPropsRef = useRef({
    lyricLines,
    alignPosition,
    currentTimeMs,
  });
  rendererPropsRef.current = { lyricLines, alignPosition, currentTimeMs };

  useLayoutEffect(() => {
    const player = new LyricPlayer();
    corePlayerRef.current = player;

    const current = rendererPropsRef.current;
    // 逐词点亮默认用 Web Animations，按物理时间自己往前走。
    // 预览是实时播放，所以和声音对齐；导出每一帧都要比歌曲时间慢很多，
    // 截图时一句的进度已经跑完，只剩第一个字还卡在该响的位置。
    // 关掉这条路径后，遮罩改为读取歌曲时间，截哪一帧就是那一帧的字。
    if (getRemotionEnvironment().isRendering) {
      Object.assign(player, { supportMaskImage: false });
    }
    player.setEnableAutoSeekDetection(false);
    player.setAlignAnchor("center");
    player.setEnableSpring(true);
    player.setEnableScale(true);
    player.setEnableBlur(true);
    player.setAlignPosition(current.alignPosition);
    player.setLyricLines(current.lyricLines, current.currentTimeMs);
    player.setCurrentTime(current.currentTimeMs, false);
    player.resume();
    player.update();
    wrapperRef.current?.appendChild(player.getElement());

    return () => {
      player.dispose();
      if (corePlayerRef.current === player) {
        corePlayerRef.current = null;
      }
    };
  }, []);

  useLayoutEffect(() => {
    const player = corePlayerRef.current;
    if (!player) {
      return;
    }
    const lyricLinesChanged = prevLyricLinesRef.current !== lyricLines;
    prevLyricLinesRef.current = lyricLines;
    if (lyricLinesChanged || player.getLyricLines().length === 0) {
      player.setLyricLines(lyricLines, currentTimeRef.current);
      player.update();
    }
  }, [lyricLines]);

  useLayoutEffect(() => {
    const player = corePlayerRef.current;
    if (!player) {
      return;
    }
    const isSeek = isLyricTimeSeek(currentTimeRef.current, currentTimeMs);
    player.setCurrentTime(currentTimeMs, isSeek);
    currentTimeRef.current = currentTimeMs;
    player.update(0);
  }, [currentTimeMs]);

  useEffect(() => {
    const player = corePlayerRef.current;
    if (!player) {
      return;
    }
    let canceled = false;
    let lastTime = -1;
    const onFrame = (time: number) => {
      if (canceled) {
        return;
      }
      if (lastTime === -1) {
        lastTime = time;
      }
      const delta = time - lastTime;
      lastTime = time;
      player.setCurrentTime(currentTimeRef.current, false);
      player.update(delta);
      requestAnimationFrame(onFrame);
    };
    player.calcLayout(LayoutReason.ConfigChange);
    requestAnimationFrame(onFrame);
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    corePlayerRef.current?.setAlignPosition(alignPosition);
  }, [alignPosition]);

  return (
    <div
      ref={wrapperRef}
      style={
        {
          width: "100%",
          height: "100%",
          "--amll-lp-font-size": "max(max(5vh, 2.5vw), 14px)",
          ...style,
        } as CSSProperties
      }
    />
  );
};
