import assert from "node:assert/strict";
import { test } from "node:test";
import { decideIdle, parseScreenLocked, type IdleInput } from "./idle";

const at = (hour: number, minute = 0) => new Date(2026, 10, 21, hour, minute).getTime();
const base = (patch: Partial<IdleInput>): IdleInput => ({
  now: at(14), enabled: true, holdUntil: null, nightStartHour: 0, nightEndHour: 6,
  lockMinutes: 10, locked: false, lockedSince: null, ...patch,
});

test("夜间窗口直接空闲", () => {
  assert.equal(decideIdle(base({ now: at(3) })).idle, true);
  assert.equal(decideIdle(base({ now: at(6) })).idle, false);
});

test("锁屏：第一次只记时间，满时长后才空闲，解锁清零", () => {
  const first = decideIdle(base({ locked: true }));
  assert.deepEqual([first.idle, first.lockedSince], [false, at(14)]);
  assert.equal(decideIdle(base({ now: at(14, 9), locked: true, lockedSince: at(14) })).idle, false);
  assert.equal(decideIdle(base({ now: at(14, 10), locked: true, lockedSince: at(14) })).idle, true);
  assert.equal(decideIdle(base({ locked: false, lockedSince: at(14) })).lockedSince, null);
});

test("开关和 hold_until 优先", () => {
  assert.equal(decideIdle(base({ now: at(3), enabled: false })).idle, false);
  assert.equal(decideIdle(base({ now: at(3), holdUntil: at(5) })).idle, false);
  assert.equal(decideIdle(base({ now: at(5, 30), holdUntil: at(5) })).idle, true);
});

test("解析 ioreg 输出", () => {
  assert.equal(parseScreenLocked('  | "CGSSessionScreenIsLocked" = Yes\n'), true);
  assert.equal(parseScreenLocked('  | "IOConsoleUsers" = ()'), false);
});
