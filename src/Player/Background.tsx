import {
  BackgroundRender,
  MeshGradientRenderer,
  type AbstractBaseRenderer,
} from "@applemusic-like-lyrics/core";
import { useWindowedAudioData, visualizeAudio } from "@remotion/media-utils";
import type { FC } from "react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import {
  resolveBackgroundMotion,
  type BackgroundMotion,
} from "./background-motion";

type PlayerBackgroundProps = {
  audioSrc: string;
  coverUrl: string;
  hasLyric: boolean;
  motion?: BackgroundMotion;
};

export const PlayerBackground: FC<PlayerBackgroundProps> = (props) => {
  // 静止背景用不到低频，也就不必解码音频。ALAC 之类浏览器解不了的编码因此也能预览
  if (props.motion === "static") {
    return <BackgroundView {...props} lowFreqVolume={1} />;
  }
  return <AnalyzedBackground {...props} />;
};

const AnalyzedBackground: FC<PlayerBackgroundProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const { audioData, dataOffsetInSeconds } = useWindowedAudioData({
    src: props.audioSrc,
    frame,
    fps,
    windowInSeconds: 30,
  });

  let lowFreqVolume = 1;
  if (audioData) {
    const bins = visualizeAudio({
      fps,
      frame,
      audioData,
      numberOfSamples: 32,
      optimizeFor: "speed",
      dataOffsetInSeconds,
    });
    const bass = bins.slice(0, 4).reduce((sum, value) => sum + value, 0) / 4;
    lowFreqVolume = Math.min(1, bass * 3);
  }

  return <BackgroundView {...props} lowFreqVolume={lowFreqVolume} />;
};

const BackgroundView: FC<
  Omit<PlayerBackgroundProps, "audioSrc"> & { lowFreqVolume: number }
> = ({ coverUrl, hasLyric, motion, lowFreqVolume }) => {
  const { fps } = useVideoConfig();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const coreBGRenderRef = useRef<AbstractBaseRenderer | null>(null);
  const album = coverUrl || undefined;

  const backgroundMotion = resolveBackgroundMotion(motion);
  const rendererPropsRef = useRef({
    album,
    fps,
    lowFreqVolume,
    hasLyric,
    backgroundMotion,
  });
  rendererPropsRef.current = {
    album,
    fps,
    lowFreqVolume,
    hasLyric,
    backgroundMotion,
  };

  useLayoutEffect(() => {
    const backgroundRender = BackgroundRender.new(MeshGradientRenderer);
    coreBGRenderRef.current = backgroundRender;

    const current = rendererPropsRef.current;
    if (current.album) {
      void backgroundRender.setAlbum(current.album);
    }
    backgroundRender.setFPS(current.fps);
    backgroundRender.setRenderScale(1);
    backgroundRender.setLowFreqVolume(current.lowFreqVolume);
    backgroundRender.setHasLyric(current.hasLyric);
    backgroundRender.setFlowSpeed(current.backgroundMotion.flowSpeed);
    backgroundRender.setStaticMode(current.backgroundMotion.staticMode);
    backgroundRender.resume();

    const element = backgroundRender.getElement();
    element.style.width = "100%";
    element.style.height = "100%";
    element.style.minWidth = "0";
    element.style.minHeight = "0";
    element.style.overflow = "hidden";
    wrapperRef.current?.appendChild(element);

    return () => {
      backgroundRender.dispose();
      if (coreBGRenderRef.current === backgroundRender) {
        coreBGRenderRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (album) {
      void coreBGRenderRef.current?.setAlbum(album);
    }
  }, [album]);

  useEffect(() => {
    coreBGRenderRef.current?.setFPS(fps);
  }, [fps]);

  useEffect(() => {
    coreBGRenderRef.current?.setLowFreqVolume(lowFreqVolume);
  }, [lowFreqVolume]);

  useEffect(() => {
    coreBGRenderRef.current?.setHasLyric(hasLyric);
  }, [hasLyric]);

  useEffect(() => {
    const renderer = coreBGRenderRef.current;
    if (!renderer) {
      return;
    }
    renderer.setFlowSpeed(backgroundMotion.flowSpeed);
    renderer.setStaticMode(backgroundMotion.staticMode);
    if (!backgroundMotion.staticMode) {
      renderer.resume();
    }
  }, [backgroundMotion.flowSpeed, backgroundMotion.staticMode]);

  return (
    <div style={{ width: "100%", height: "100%", overflow: "hidden" }}>
      <div
        ref={wrapperRef}
        style={{
          width: "100%",
          height: "100%",
          filter: "blur(48px)",
          transform: "scale(1.15)",
        }}
      />
    </div>
  );
};
