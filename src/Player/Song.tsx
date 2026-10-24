import { Audio } from "@remotion/media";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AbsoluteFill, Sequence, getRemotionEnvironment, useDelayRender, useVideoConfig } from "remotion";
import { resolvePublicAsset } from "../helpers/public-asset";
import type { TrackProps } from "../helpers/schema";
import { PlayerBackground } from "./Background";
import { Cover } from "./Cover";
import { playerFontFamily } from "./font";
import { Lyrics } from "./Lyrics";
import { MusicInfo } from "./MusicInfo";

export const SongPlayer: React.FC<TrackProps> = ({
  audioFileUrl,
  coverImageUrl = "",
  songName = "",
  artistName = "",
  albumName = "",
  lyricLines = [],
  audioOffsetInSeconds,
  backgroundMotion = "slow",
}) => {
  const { fps } = useVideoConfig();
  const { isRendering } = getRemotionEnvironment();
  const audioSrc = resolvePublicAsset(audioFileUrl);
  const coverSrc = resolvePublicAsset(coverImageUrl);
  const audioOffsetInFrames = Math.round(audioOffsetInSeconds * fps);
  const hasLyric = lyricLines.length > 0;
  const { delayRender, continueRender } = useDelayRender();
  const [handle] = useState(() => delayRender("amll-player-ready"));
  const coverRef = useRef<HTMLDivElement>(null);
  const lyricRef = useRef<HTMLDivElement>(null);
  const [alignPosition, setAlignPosition] = useState(0.5);

  useLayoutEffect(() => {
    const coverEl = coverRef.current;
    const lyricEl = lyricRef.current;
    if (!coverEl || !lyricEl) {
      return;
    }

    const update = () => {
      const coverBox = coverEl.getBoundingClientRect();
      const lyricBox = lyricEl.getBoundingClientRect();
      if (lyricBox.height === 0) {
        return;
      }
      setAlignPosition(
        (coverBox.top + coverBox.height / 2 - lyricBox.top) / lyricBox.height,
      );
    };

    const observer = new ResizeObserver(update);
    observer.observe(coverEl);
    observer.observe(lyricEl);
    update();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let innerId = 0;
    const outerId = requestAnimationFrame(() => {
      innerId = requestAnimationFrame(() => {
        if (!cancelled) {
          continueRender(handle);
        }
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(outerId);
      cancelAnimationFrame(innerId);
    };
  }, [continueRender, handle]);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#111"
      }}
    >
      <Sequence from={-audioOffsetInFrames}>
        <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
          <PlayerBackground
            audioSrc={audioSrc}
            coverUrl={coverSrc}
            hasLyric={hasLyric}
            motion={backgroundMotion}
          />
          <div
            style={{
              pointerEvents: "none",
              position: "absolute",
              inset: 0,
              backgroundImage:
                "linear-gradient(to bottom, transparent 60%, rgb(0 0 0 / 0.1))",
            }}
          />
        </div>
        {!isRendering ? <Audio src={audioSrc} /> : null}
      </Sequence>
      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          height: "100%",
          fontFamily: playerFontFamily,
          color: "white",
        }}
      >
        <div
          style={{
            display: "grid",
            width: "100%",
            height: "100%",
            gridTemplateColumns: hasLyric ? "0.45fr 0.55fr" : "1fr",
            gap: hasLyric ? "0.5rem" : 0,
          }}
        >
          <div
            style={{
              display: "flex",
              minWidth: 0,
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              mixBlendMode: "plus-lighter",
            }}
          >
            <div
              ref={coverRef}
              style={{
                position: "relative",
                width: "min(50vh, 38vw)",
                height: "min(50vh, 38vw)",
              }}
            >
              <Cover coverUrl={coverSrc} />
            </div>
            <MusicInfo
              style={{ marginTop: "1.75em", width: "min(50vh, 38vw)" }}
              songName={songName}
              artistName={artistName}
              albumName={albumName}
            />
          </div>
          {hasLyric ? (
            <div
              ref={lyricRef}
              style={{
                boxSizing: "border-box",
                width: "100%",
                height: "100%",
                contain: "paint",
                paddingRight: "15%",
                mixBlendMode: "plus-lighter",
                maskImage:
                  "linear-gradient(transparent, black 10%, black 90%, transparent)",
              }}
            >
              <Lyrics lyricLines={lyricLines} alignPosition={alignPosition} />
            </div>
          ) : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};
