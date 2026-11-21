export type IdleInput = {
  now: number;
  enabled: boolean;
  holdUntil: number | null;
  nightStartHour: number;
  nightEndHour: number;
  lockMinutes: number;
  locked: boolean;
  lockedSince: number | null;
};

export type IdleDecision = {
  idle: boolean;
  /** 要写回 runner_state 的 locked_since。 */
  lockedSince: number | null;
  reason: string;
};

export function decideIdle(input: IdleInput): IdleDecision {
  const lockedSince = !input.locked ? null : (input.lockedSince ?? input.now);
  if (!input.enabled) return { idle: false, lockedSince, reason: "空闲调度已关闭" };
  if (input.holdUntil != null && input.now < input.holdUntil) {
    return { idle: false, lockedSince, reason: "还在 hold_until 之前" };
  }
  const hour = new Date(input.now).getHours();
  if (hour >= input.nightStartHour && hour < input.nightEndHour) {
    return { idle: true, lockedSince, reason: "夜间窗口" };
  }
  if (!input.locked) return { idle: false, lockedSince, reason: "屏幕未锁定，不在夜间窗口" };
  if (input.lockedSince == null) return { idle: false, lockedSince, reason: "刚发现锁屏，先记下时间" };
  const lockedMs = input.now - input.lockedSince;
  if (lockedMs >= input.lockMinutes * 60_000) return { idle: true, lockedSince, reason: "锁屏已满时长" };
  return { idle: false, lockedSince, reason: "锁屏还没满时长" };
}

export function parseScreenLocked(ioregOutput: string): boolean {
  return /"CGSSessionScreenIsLocked"\s*=\s*Yes/.test(ioregOutput);
}
