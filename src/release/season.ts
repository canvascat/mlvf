export function classifySeasonAdd(
  exitCode: number,
  output: string,
): "ok" | "wait-rate" | "wait-missing" | "fail" {
  if (
    output.includes("已将")
    || output.includes("已存在")
    || /(?<!\d)20080(?!\d)/.test(output)
  ) {
    return "ok";
  }
  if (/(?<!\d)20111(?!\d)/.test(output) || /(?<!\d)256000(?!\d)/.test(output)) {
    return "wait-rate";
  }
  if (output.includes("啥都木有") || output.includes("-404")) {
    return "wait-missing";
  }
  if (exitCode !== 0) return "fail";
  return "fail";
}
