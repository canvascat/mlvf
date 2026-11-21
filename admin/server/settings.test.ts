import assert from "node:assert/strict";
import { test } from "node:test";
import { openDb } from "./db/client";
import { getSettings, resetSettings, SETTING_DEFAULTS, settingWarnings, updateSettings } from "./settings";

test("没有记录时返回默认值", () => {
  assert.deepEqual(getSettings(openDb(":memory:")), SETTING_DEFAULTS);
});

test("更新后立即读到，其余保持默认", () => {
  const db = openDb(":memory:");
  const next = updateSettings(db, { "upload.minIntervalSec": 240, "idle.enabled": false });
  assert.equal(next["upload.minIntervalSec"], 240);
  assert.equal(next["idle.enabled"], false);
  assert.equal(next["bili.maxParallel"], 1);
});

test("非法值被拒绝且不落库", () => {
  const db = openDb(":memory:");
  assert.throws(() => updateSettings(db, { "render.maxParallel": 0 }), /render\.maxParallel/);
  assert.throws(() => updateSettings(db, { "render.frameConcurrency": "abc" }), /数字或百分比/);
  assert.throws(() => updateSettings(db, { "idle.nightStartHour": 7 }), /小于/);
  assert.deepEqual(getSettings(db), SETTING_DEFAULTS);
});

test("恢复默认，可只恢复部分", () => {
  const db = openDb(":memory:");
  updateSettings(db, { "upload.minIntervalSec": 10, "season.writeIntervalSec": 9 });
  assert.equal(resetSettings(db, ["upload.minIntervalSec"])["upload.minIntervalSec"], 180);
  assert.equal(getSettings(db)["season.writeIntervalSec"], 9);
  assert.deepEqual(resetSettings(db), SETTING_DEFAULTS);
});

test("偏离默认值时给出警告", () => {
  const db = openDb(":memory:");
  assert.deepEqual(settingWarnings(getSettings(db)), []);
  const warned = settingWarnings(updateSettings(db, { "upload.minIntervalSec": 60, "bili.maxParallel": 2 }));
  assert.deepEqual(warned.map((w) => w.key), ["upload.minIntervalSec", "bili.maxParallel"]);
});
