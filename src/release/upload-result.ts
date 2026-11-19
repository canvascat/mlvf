const CODE = (value: string) => new RegExp(`(?<!\\d)${value}(?!\\d)`);

export function bvidFrom(output: string): string | null {
  const found = output.match(/BV[0-9A-Za-z]{10}/g);
  return found?.at(-1) ?? null;
}

export function classifyUpload(
  exitCode: number,
  output: string,
  alreadyWaitedGap: boolean,
): "ok" | "retry" | "draft" | "fail" {
  const limited = CODE("21566").test(output);
  const blocked = CODE("137022").test(output) || output.includes("投稿过于频繁");
  if (blocked && (alreadyWaitedGap || !limited || CODE("137022").test(output))) {
    return "draft";
  }
  if (limited && !alreadyWaitedGap) return "retry";
  if (limited && alreadyWaitedGap) return "draft";
  if (
    exitCode === 0
    && output.includes("Web 接口投稿成功")
    && bvidFrom(output)
    && !limited
    && !blocked
  ) {
    return "ok";
  }
  return "fail";
}
