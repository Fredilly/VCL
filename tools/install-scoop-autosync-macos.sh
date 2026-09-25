#!/bin/bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/org.article6.scoop-dev-auto.plist"
LOG_DIR="$HOME/Library/Logs/Scoop"

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
    <string>cd "${REPO_DIR}" &amp;&amp; pnpm dev:auto</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
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
