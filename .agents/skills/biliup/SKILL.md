---
name: biliup
description: Use the biliup CLI (biliup-cli 1.2.11) to log in, upload, append, list, download, run the WebUI or Fleet controller, and manage seasons. There is no upload bandwidth cap; --limit is chunk concurrency.
---

# biliup

Use this skill when the user wants to install or operate the `biliup` command-line tool. Behavior below matches `biliup-cli 1.2.11`. If a flag is not listed here, run `biliup <command> --help` instead of guessing.

`biliup` can log in, upload videos, append a part to an existing archive, inspect or list videos, download videos, start the WebUI, join a Fleet controller, and manage the user's collections (合集).

Global options:

- `-u` / `--user-cookie` is the login file. The CLI default is `cookies.json` in the working directory. On this machine the saved login is `~/.config/biliup/cookies.json`; pass `-u` with that path when generating commands here.
- `-p` / `--proxy` sets a proxy.
- `--rust-log` sets the log filter.

Do not print cookie values.

## Install flow

When the user needs to install `biliup`, choose one installation path based on the user's operating system and preference.

### GitHub Releases prebuilt package

Use this path when the user wants to install a prebuilt binary from GitHub Releases.

For Linux or macOS, generate and run this script. Set `INSTALL_DIR` to the user's target directory when needed.

```bash
set -euo pipefail

REPO="biliup/biliup"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux) os="linux" ;;
  Darwin) os="macos" ;;
  *) echo "Unsupported OS: $OS" >&2; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64) arch="x86_64" ;;
  aarch64|arm64) arch="aarch64" ;;
  armv7l|armv7*) arch="arm" ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

asset="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
  | python3 -c 'import json,sys; data=json.load(sys.stdin); os=sys.argv[1]; arch=sys.argv[2]; assets=[a["name"] for a in data["assets"]]; matches=[n for n in assets if n.endswith(".tar.xz") and f"-{arch}-{os}.tar.xz" in n]; print(matches[0] if matches else "")' "$os" "$arch")"

if [ -z "$asset" ]; then
  echo "No matching biliup release asset for ${arch}-${os}" >&2
  exit 1
fi

url="https://github.com/${REPO}/releases/latest/download/${asset}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fL "$url" -o "$tmp/$asset"
tar -xJf "$tmp/$asset" -C "$tmp"
mkdir -p "$INSTALL_DIR"
install -m 755 "$(find "$tmp" -type f -name biliup | head -n 1)" "$INSTALL_DIR/biliup"

"$INSTALL_DIR/biliup" --help
```

For Windows PowerShell, generate and run this script. Set `$InstallDir` to the user's target directory when needed.

```powershell
$ErrorActionPreference = "Stop"

$Repo = "biliup/biliup"
$InstallDir = if ($env:INSTALL_DIR) { $env:INSTALL_DIR } else { Join-Path $env:USERPROFILE "bin" }
$Arch = if ([Environment]::Is64BitOperatingSystem) { "x86_64" } else { throw "Unsupported Windows architecture" }

$Release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest"
$Asset = $Release.assets | Where-Object { $_.name -like "biliupR-v*-$Arch-windows.zip" } | Select-Object -First 1
if (-not $Asset) { throw "No matching biliup release asset for $Arch-windows" }

$Tmp = New-Item -ItemType Directory -Force (Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString()))
try {
  $Zip = Join-Path $Tmp.FullName $Asset.name
  Invoke-WebRequest $Asset.browser_download_url -OutFile $Zip
  Expand-Archive $Zip -DestinationPath $Tmp.FullName -Force
  New-Item -ItemType Directory -Force $InstallDir | Out-Null
  $Exe = Get-ChildItem $Tmp.FullName -Recurse -Filter biliup.exe | Select-Object -First 1
  if (-not $Exe) { throw "biliup.exe not found in release archive" }
  Copy-Item $Exe.FullName (Join-Path $InstallDir "biliup.exe") -Force
  & (Join-Path $InstallDir "biliup.exe") --help
} finally {
  Remove-Item $Tmp.FullName -Recurse -Force
}
```

If the target directory is not on `PATH`, tell the user to run `biliup` by its full path or add the target directory to `PATH`.

### npm

Use this path when the user has Node.js (npm) available:

```bash
npm i -g @biliup/cli
```

Then verify:

```bash
biliup --help
```

## Upload

`upload` posts a new archive. `append --vid <BV or av>` adds another part to an existing archive. Append does not replace the existing part.

This repo does not upload a finished video unless the user explicitly asked to upload it now. Otherwise append one item to `tmp/upload-queue.json` and leave it `pending`. Drain that queue only in the idle window in `AGENTS.md`: local time 00:00–05:59, or the screen locked for 10 minutes. In that window, publish drafts before `pending` items. `mode` is `first` or `overwrite`.

- `first` runs `biliup upload --submit web` with the `upload` object saved on the item (title, desc, tag, cover, tid, copyright, dynamic, hires). One album batch stores `--dynamic` on a single item.
- `overwrite` keeps the existing BV. `show` the archive, `append --submit web --vid <bvid>` the new file, then `POST https://member.bilibili.com/x/vu/web/edit` with the previous studio fields and `videos` set to only the new part. Keep the old part title. Confirm with `show` that the only remaining cid is the new one. Do not `upload` a second archive for the same song.

This repo's uploads must use `--submit web`. Without `--submit`, the CLI uses the app submit path. `--submit` also accepts `app` and `b-cut-android`.

There is no bandwidth cap. `--limit` is how many chunks of one file upload at once (default 3). `--limit 1` uploads one chunk at a time and is slower, but it is not a fixed Mbps limit. `--line` picks an upload line (`bldsa`, `tx`, `bda2`, `akbd`, `estx`, and the other names from `biliup upload --help`).

A probe warning that `*.bilivideo.com` certificate is expired (`-67818`), or that the `bldsa` line was skipped, is not a failed upload. Skip that line and keep going. Do not treat the word `Error` inside that TLS warning as a failed submit.

A post succeeded only when the process exits 0, the output contains `Web 接口投稿成功`, and it contains a BV id. The file can finish uploading and the checkpoint can be deleted before submit fails. That run did not create an archive. Retrying uploads the file again.

Rate limits:

- `21566` or the text `投稿过于频繁` on that code: wait at least 180 seconds, then retry the same upload. Do not start the next video. Match `21566` only as its own number; a file size can contain those digits.
- `137022` with `投稿过于频繁，请稍后再试` is a longer block. Waiting 6 minutes and retrying still failed across six attempts in one session, and each retry uploaded the file again. Stop and tell the user. Do not keep re-uploading on `137022`.
- This repo's batch of new archives already waits 180 seconds. If that submit still returns `21566`, `137022`, or `投稿过于频繁`, save that video and the rest of the batch as drafts instead of running `biliup upload` again. `overwrite` does not use drafts. The draft box holds at most 30; count them with `GET https://member.bilibili.com/x/vupre/web/draft/list?pn=1&ps=30` (`data` is the array) and stop when `30 - count` is used up. Do not delete existing drafts. Save one at a time with `POST https://member.bilibili.com/x/vupre/web/draft/add?csrf=` and the same JSON as a web submit, at least 3 seconds after the previous success. Reuse `filename` and `cid` from the upload that already finished. Mark the queue item `draft` with `draft_id`. Do not publish those drafts in the same batch. On the next idle window, publish drafts first: `GET https://member.bilibili.com/x/vupre/web/draft/view?id=<draft_id>`, then `POST https://member.bilibili.com/x/vu/web/add/v3?csrf=` with the returned `videos` (`filename` and `cid` are already there). After a BV comes back, `POST https://member.bilibili.com/x/vupre/web/draft/delete?csrf=` and mark the queue item `done`. If publishing a draft is rate-limited, stop the idle drain and leave the remaining drafts in the box.

Other upload flags worth passing explicitly: `--copyright` (1 original, 2 repost), `--tid` (CLI default is 171; this repo uses 130 for music), `--cover`, `--title`, `--desc`, `--tag` (comma-separated), `--dynamic`, `--hires` (0 or 1), `--dolby`, `--no-reprint`, `--dtime` (10-digit timestamp, at least 4 hours ahead).

## Collections

`season` reads the cookie file. Run `biliup login` first if it does not exist. Add `--json` for machine-readable output. `sections` and `show` print a log line before the JSON; parse from the first `{`.

```bash
biliup -u ~/.config/biliup/cookies.json season list --json
biliup -u ~/.config/biliup/cookies.json season sections <season_id> --json
biliup -u ~/.config/biliup/cookies.json season add <section_id> --vid <BV or av>
biliup -u ~/.config/biliup/cookies.json season remove <episode_id>
biliup -u ~/.config/biliup/cookies.json season sort <section_id> --season-id <season_id> <episode_id>...
```

`list` shows season and section IDs. `sections` shows each episode's `episode_id` (not the aid), which `remove` and `sort` take. `add` looks up the cid and title and accepts `--vid` more than once. `sort` moves the listed episodes to the front in the given order and keeps the rest. `--reverse` reverses the whole section. Pass `--season-id` when the section payload has no season id.

The CLI cannot create a season, switch grouping on, rename a section, or delete an archive.

Write operations on a season need a gap. Wait at least 3 seconds after a successful season write before the next one. `20111` and `256000` mean edits are too frequent: wait tens of seconds and retry that same call. `20081` (a type-1 正片 group already exists) and `20092` (too many sections) are not rate limits.

A newly submitted video often returns archive-view `-404` / `啥都木有` for several minutes. Retry that season add; do not treat it as a permanent failure.

## Server, users, and Fleet

WebUI, authenticated:

```bash
biliup server --auth
```

Bind and port when the user names them. The default bind is `127.0.0.1` and the default port is `19159`.

```bash
biliup server --bind 0.0.0.0 --port 19159 --auth
```

`--secure-session-cookie` marks the session cookie Secure. Use it only behind HTTPS. On plain HTTP the browser drops the login.

A biliup 1.0.7 recording config:

```bash
biliup server --config config.toml
```

Replace `config.toml` with the user's config file path.

Background on Linux or macOS:

```bash
nohup biliup server --auth &
```

`--controller` runs this process as a Fleet control plane (data in `data/fleet.sqlite3`). `--relay-listen` and `--relay-url` apply only with `--controller`.

`biliup user` manages Web UI users in `data/data.sqlite3` from the server's working directory: `list`, `reset-password`.

`biliup node` manages this machine's Fleet membership in `data/node.json`: `join` (then restart `biliup server`), `leave`, `status`.

## Other commands

- `login` saves Bilibili login info. `renew` checks and refreshes it.
- `show <BV or av>` prints archive details.
- `list` lists uploaded videos. `--is-pubing`, `--pubed`, and `--not-pubed` filter by status. `--from-page` and `--max-pages` page through them.
- `download <url>` saves a video. `--output` is a filename template. `--split-size` and `--split-time` split the download.
- `comments <vid>` lists comments. `reply <vid> <rpid> <message>` only prints the reply unless `--execute` is set.
- `dump-flv <file>` prints FLV metadata.

## Help flow

When the user asks what commands are available, show:

```bash
biliup --help
```

When the user asks about server options, show:

```bash
biliup server --help
```

When the user asks about a specific command, use:

```bash
biliup <command> --help
```

Replace `<command>` with the requested subcommand.

## Commands

```text
login
renew
upload
append
show
comments
reply
dump-flv
download
server
season
user
node
list
```

When generating a command, include the concrete paths required by that command, such as the cookie file, config file, and video path.
