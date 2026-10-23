/** 一次前进超过这个间隔才当成跳转。逐帧时钟（约 16–42ms）必须留在下面。 */
export const LYRIC_SEEK_GAP_MS = 200;

/**
 * Remotion 每帧都会推一次播放进度。
 * 只有倒退或跨过多个帧才是跳转；逐帧前进要留给间奏三点沿歌曲时间演出。
 */
export function isLyricTimeSeek(previousMs: number, nextMs: number): boolean {
  if (nextMs < previousMs) {
    return true;
  }
  return nextMs - previousMs > LYRIC_SEEK_GAP_MS;
}
