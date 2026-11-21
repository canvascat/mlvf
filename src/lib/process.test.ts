import assert from "node:assert/strict";
import { test } from "node:test";
import { abortableSleep, streamCommand } from "./process";

test("streamCommand 按 \\n 和 \\r 切行，返回退出码", async () => {
  const lines: string[] = [];
  const result = await streamCommand(["sh", "-c", "printf 'a\\rb\\nc'; echo err >&2; exit 3"], {
    onLine: (line, stream) => lines.push(`${stream}:${line}`),
  });
  assert.equal(result.exitCode, 3);
  assert.deepEqual(lines.sort(), ["stderr:err", "stdout:a", "stdout:b", "stdout:c"]);
});

test("中止信号会结束子进程", async () => {
  const controller = new AbortController();
  const started = Date.now();
  const running = streamCommand(["sleep", "30"], { signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  const result = await running;
  assert.equal(result.aborted, true);
  assert.ok(Date.now() - started < 3000);
});

test("可取消的等待", async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(abortableSleep(5000, controller.signal), /已取消/);
});
