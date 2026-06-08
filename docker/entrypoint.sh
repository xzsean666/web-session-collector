#!/usr/bin/env bash
set -euo pipefail

APP_USER_DATA_DIR="${APP_USER_DATA_DIR:-/data/chrome-user-data}"
mkdir -p "${APP_USER_DATA_DIR}"

# Remove stale Chromium singleton locks left behind when a previous container
# was killed without a clean browser shutdown. The persistent profile volume
# keeps these locks, which point at the old container's hostname/pid and make
# the new Chromium refuse to launch ("profile appears to be in use"). A fresh
# container never has a legitimate Chromium running yet, so clearing them here
# is safe.
rm -f "${APP_USER_DATA_DIR}/SingletonLock" \
      "${APP_USER_DATA_DIR}/SingletonSocket" \
      "${APP_USER_DATA_DIR}/SingletonCookie"

export DISPLAY="${DISPLAY:-:99}"
VNC_RESOLUTION="${VNC_RESOLUTION:-1366x768x24}"
VNC_PORT="${VNC_PORT:-5900}"
ACTIVE_NOVNC_PORT="${ACTIVE_NOVNC_PORT:-10086}"
IDLE_NOVNC_PORT="${IDLE_NOVNC_PORT:-10087}"

Xvfb "${DISPLAY}" -screen 0 "${VNC_RESOLUTION}" -nolisten tcp >/tmp/xvfb.log 2>&1 &

# Wait for Xvfb to create its display socket before starting clients that
# need it. Without this, x11vnc races Xvfb startup and exits with
# "XOpenDisplay failed", leaving noVNC unable to connect.
for _ in $(seq 1 100); do
  if [[ -S "/tmp/.X11-unix/X${DISPLAY#:}" ]]; then
    break
  fi
  sleep 0.1
done

fluxbox >/tmp/fluxbox.log 2>&1 &

X11VNC_ARGS=(
  -display "${DISPLAY}"
  -forever
  -shared
  -rfbport "${VNC_PORT}"
)

if [[ -n "${VNC_PASSWORD:-}" ]]; then
  X11VNC_ARGS+=(-passwd "${VNC_PASSWORD}")
else
  X11VNC_ARGS+=(-nopw)
fi

x11vnc "${X11VNC_ARGS[@]}" >/tmp/x11vnc.log 2>&1 &
websockify --web=/usr/share/novnc "${ACTIVE_NOVNC_PORT}" "127.0.0.1:${VNC_PORT}" >/tmp/active-novnc.log 2>&1 &

if [[ "${IDLE_NOVNC_PORT}" != "${ACTIVE_NOVNC_PORT}" ]]; then
  websockify --web=/usr/share/novnc "${IDLE_NOVNC_PORT}" "127.0.0.1:${VNC_PORT}" >/tmp/idle-novnc.log 2>&1 &
fi

exec "$@"
