import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isAlbumPreviewCommand,
  isRemotionStudioCommand,
} from "./studio-guard";

const root = "/Volumes/M1T/workspace/rmv";

test("识别本仓库 remotion studio", () => {
  const cmd = `${root}/node_modules/.bin/remotion studio ${root}/src/index.ts --port=3000`;
  assert.equal(isRemotionStudioCommand(cmd, root), true);
});

test("不杀无关进程的命令行", () => {
  assert.equal(isRemotionStudioCommand("node other-server.js", root), false);
  assert.equal(
    isRemotionStudioCommand("remotion studio /other/repo/src/index.ts", root),
    false,
  );
});

test("识别 album-preview", () => {
  const cmd = `node ${root}/src/export/album-preview.ts 预处理/foo`;
  assert.equal(isAlbumPreviewCommand(cmd, root), true);
});