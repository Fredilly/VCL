#!/bin/bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/org.article6.scoop-dev-auto.plist"
LOG_DIR="$HOME/Library/Logs/Scoop"
PNPM_BIN="$(command -v pnpm || true)"
NODE_BIN="$(command -v node || true)"

if [[ -z "$PNPM_BIN" || -z "$NODE_BIN" ]]; then
  echo "Both pnpm and node must be available on PATH. Install them, then run this setup again." >&2
  exit 1
fi

TOOL_PATH="$(dirname "$NODE_BIN"):$(dirname "$PNPM_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

mkdir -p "$(dirname "$PLIST")" "$LOG_DIR"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>org.article6.scoop-dev-auto</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>cd "${REPO_DIR}" &amp;&amp; exec "${PNPM_BIN}" dev:auto</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${TOOL_PATH}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/dev-auto.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/dev-auto.err.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/org.article6.scoop-dev-auto"

echo "Scoop auto-sync is installed and running."
echo "One-time Brave step:"
echo "  Load apps/extension/.output/chrome-mv3-dev as an unpacked extension."
echo "After that, merges to main are pulled automatically and WXT reloads Scoop."
