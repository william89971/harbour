#!/usr/bin/env bash
# Harbour release: stop the running production server, rebuild, restart cleanly.
#
# Why: `next start` reads the build manifest at startup and doesn't watch .next/.
# Rebuilding in place while the old server runs produces stale-chunk 404s/500s
# until the process is restarted. Stopping before the build avoids that window
# entirely (launchd's KeepAlive would otherwise respawn the server mid-build).
#
# Currently macOS/launchd only. Extend for Linux/systemd when that install path
# lands in bin/lib/install.mjs.

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "release.sh: only macOS/launchd is supported right now" >&2
  exit 1
fi

LABEL="com.harbour.server"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
DOMAIN="gui/$(id -u)"

if [[ ! -f "$PLIST" ]]; then
  echo "release.sh: $PLIST not found — harbour server isn't installed as a launch agent" >&2
  exit 1
fi

echo "==> Stopping $LABEL"
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true

echo "==> Building"
npm run build

echo "==> Starting $LABEL"
launchctl bootstrap "$DOMAIN" "$PLIST"

sleep 2
if launchctl list | grep -q "${LABEL}$"; then
  echo "==> OK: $LABEL is running"
else
  echo "release.sh: $LABEL not listed by launchctl after bootstrap" >&2
  exit 1
fi
