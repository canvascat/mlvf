import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function studioPageUrl(port: number, compositionId: string): string {
  return `http://localhost:${port}/${compositionId}`;
}

export type RefreshStudioBrowserOptions = {
  /** 找不到已有 Studio 标签时是否新开；切歌时应为 false。 */
  allowOpen?: boolean;
};

function darwinReloadScript(port: number, allowOpen: boolean): string {
  const portToken = `:${port}`;
  const openTail = allowOpen
    ? `open location "http://localhost:${port}"
return "opened"`
    : 'return "miss"';
  return `
on urlIsStudio(u, portToken)
  if u does not contain portToken then return false
  if u contains "localhost" then return true
  if u contains "127.0.0.1" then return true
  return false
end urlIsStudio

on reloadStudioTab(browserName, portToken)
  tell application browserName
    if not running then return false
    repeat with w in windows
      set tabIndex to 1
      repeat with t in tabs of w
        set u to (URL of t) as text
        if my urlIsStudio(u, portToken) then
          set index of w to 1
          set active tab index of w to tabIndex
          activate
          reload t
          return true
        end if
        set tabIndex to tabIndex + 1
      end repeat
    end repeat
  end tell
  return false
end reloadStudioTab

set portToken to "${portToken}"
set browserList to {"Google Chrome", "Chromium", "Microsoft Edge", "Brave Browser", "Arc"}
repeat with browserName in browserList
  if my reloadStudioTab(browserName, portToken) then return "ok"
end repeat
tell application "Safari"
  if running then
    repeat with w in windows
      repeat with t in tabs of w
        set u to (URL of t) as text
        if my urlIsStudio(u, portToken) then
          set index of w to 1
          set current tab of w to t
          tell window 1 to set current tab to tab 1
          activate
          tell application "System Events"
            keystroke "r" using command down
          end tell
          return "ok"
        end if
      end repeat
    end repeat
  end if
end tell
${openTail}
`;
}

/** 在已有 Studio 标签上 reload；默认不新开 tab。 */
export async function refreshStudioBrowser(
  port: number,
  _compositionId: string,
  options: RefreshStudioBrowserOptions = {},
): Promise<boolean> {
  const allowOpen = options.allowOpen ?? false;

  if (process.platform === "darwin") {
    try {
      const { stdout } = await execFileAsync("osascript", [
        "-e",
        darwinReloadScript(port, allowOpen),
      ]);
      const result = stdout.trim();
      return result === "ok" || result === "opened";
    } catch {
      if (allowOpen) {
        await execFileAsync("open", [`http://localhost:${port}`]);
        return true;
      }
      return false;
    }
  }

  if (allowOpen) {
    const targetUrl = `http://localhost:${port}`;
    if (process.platform === "win32") {
      try {
        await execFileAsync("cmd", ["/c", "start", "", targetUrl]);
        return true;
      } catch {
        return false;
      }
    }
    try {
      await execFileAsync("xdg-open", [targetUrl]);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}