import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pickPath, startDirOf, type PickDeps } from "./pick-path";

function deps(result: { exitCode: number; output: string }, calls: string[][] = []): PickDeps {
  return { platform: "darwin", run: async (command) => { calls.push(command); return result; } };
}

test("选中文件夹时去掉结尾斜杠，并按类型传参", async () => {
  const calls: string[][] = [];
  const picked = await pickPath(deps({ exitCode: 0, output: "/Users/yz/预处理/专辑/\n" }, calls), { kind: "folder" });
  assert.equal(picked, "/Users/yz/预处理/专辑");
  assert.equal(calls[0]?.[0], "osascript");
  assert.deepEqual(calls[0]?.slice(3), ["folder", "选择文件夹", ""]);
});

test("选中文件原样返回", async () => {
  const picked = await pickPath(deps({ exitCode: 0, output: "/a/b.flac\n" }), { kind: "file" });
  assert.equal(picked, "/a/b.flac");
});

test("用户取消返回 null，其他错误抛出", async () => {
  const cancelled = "execution error: User canceled. (-128)";
  assert.equal(await pickPath(deps({ exitCode: 1, output: cancelled }), { kind: "file" }), null);
  await assert.rejects(pickPath(deps({ exitCode: 1, output: "boom" }), { kind: "file" }), /boom/);
});

test("非 macOS 直接报错，不起进程", async () => {
  const calls: string[][] = [];
  await assert.rejects(
    pickPath({ platform: "linux", run: async (c) => { calls.push(c); return { exitCode: 0, output: "" }; } }, { kind: "file" }),
    /只支持 macOS/,
  );
  assert.equal(calls.length, 0);
});

test("起始目录：目录用自身，文件用所在目录，无效值留空", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pick-"));
  const file = path.join(dir, "a.flac");
  writeFileSync(file, "");
  assert.equal(startDirOf(dir), dir);
  assert.equal(startDirOf(file), dir);
  assert.equal(startDirOf(path.join(dir, "nope")), "");
  assert.equal(startDirOf("relative/path"), "");
  assert.equal(startDirOf(undefined), "");
});
