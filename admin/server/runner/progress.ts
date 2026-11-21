/**
 * 把 remotion render 的输出行换成 0 到 1 的整体进度，认不出的行返回 null。
 * 真实输出有三种：`Bundling 8%`、`Rendered 120/8056, time remaining: …`、`Encoded 88/8056`。
 * 打包占前 5%，渲染占 5% 到 90%；Encoded 跟在渲染后面，不单独计算。
 */
export function parseRenderProgress(line: string): number | null {
  const bundling = /^Bundling (\d+)%/.exec(line);
  if (bundling) return (Number(bundling[1]) / 100) * 0.05;
  const rendered = /^Rendered (\d+)\/(\d+)/.exec(line);
  if (rendered) {
    const total = Number(rendered[2]);
    if (total <= 0) return null;
    return 0.05 + 0.85 * Math.min(1, Number(rendered[1]) / total);
  }
  return null;
}

/** 进度行每帧一条，不逐行写日志。 */
export function isProgressLine(line: string): boolean {
  return /^(Bundling \d+%|Rendered \d+\/\d+|Encoded \d+\/\d+)/.test(line);
}
