const FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hourCycle: "h23",
});

/** 毫秒时间戳转成队列里一直在用的 `YYYY-MM-DDTHH:mm:ss+08:00`。 */
export function toShanghaiIso(ms: number): string {
  const parts = FORMAT.formatToParts(new Date(ms));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick("minute")}:${pick("second")}+08:00`;
}

/** 解析队列里的时间。没有时区的旧数据按东八区算。 */
export function fromIso(text: string): number {
  const hasZone = /(Z|[+-]\d\d:?\d\d)$/.test(text);
  const ms = Date.parse(hasZone ? text : `${text}+08:00`);
  if (!Number.isFinite(ms)) throw new Error(`无法解析时间: ${text}`);
  return ms;
}
