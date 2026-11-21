import { existsSync, statSync } from "node:fs";
import path from "node:path";

export type PickKind = "file" | "folder";
export type RunResult = { exitCode: number; output: string };
export type PickDeps = {
  platform: NodeJS.Platform;
  run: (command: string[]) => Promise<RunResult>;
};

// 参数用 argv 传入，路径和提示里的引号不会拼进脚本。
// 对话框挂在 System Events 下并 activate，避免被终端或浏览器盖住。
export const PICK_SCRIPT = `on run argv
  set pickKind to item 1 of argv
  set promptText to item 2 of argv
  set startDir to item 3 of argv
  tell application "System Events"
    activate
    if startDir is "" then
      if pickKind is "folder" then
        set picked to choose folder with prompt promptText
      else
        set picked to choose file with prompt promptText
      end if
    else
      set startAlias to POSIX file startDir as alias
      if pickKind is "folder" then
        set picked to choose folder with prompt promptText default location startAlias
      else
        set picked to choose file with prompt promptText default location startAlias
      end if
    end if
    return POSIX path of picked
  end tell
end run`;

/** 起始目录：传入的是目录就用它，是文件就用它所在目录，不存在就不指定。 */
export function startDirOf(current: string | undefined): string {
  if (!current || !path.isAbsolute(current)) return "";
  try {
    if (!existsSync(current)) return "";
    return statSync(current).isDirectory() ? current : path.dirname(current);
  } catch {
    return "";
  }
}

/** 弹出 macOS 原生选择框。取消返回 null；系统不支持或脚本出错时抛错。 */
export async function pickPath(
  deps: PickDeps,
  options: { kind: PickKind; current?: string },
): Promise<string | null> {
  if (deps.platform !== "darwin") throw new Error("选择器只支持 macOS，请直接粘贴路径");
  const prompt = options.kind === "folder" ? "选择文件夹" : "选择文件";
  const result = await deps.run([
    "osascript", "-e", PICK_SCRIPT, options.kind, prompt, startDirOf(options.current),
  ]);
  if (result.exitCode !== 0) {
    if (result.output.includes("-128")) return null;
    throw new Error(result.output.trim() || "选择器异常退出");
  }
  const picked = result.output.trim();
  if (!picked) return null;
  // 文件夹的 POSIX path 带结尾斜杠，去掉后和手输的一致。
  return picked.length > 1 ? picked.replace(/\/+$/, "") : picked;
}
