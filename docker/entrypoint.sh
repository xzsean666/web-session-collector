#!/usr/bin/env bash
set -euo pipefail

APP_USER_DATA_DIR="${APP_USER_DATA_DIR:-/data/chrome-user-data}"
mkdir -p "${APP_USER_DATA_DIR}"

# 浏览器 channel 自适应:APP_BROWSER_CHANNEL=auto(或空)时,解析为构建时按架构探测的
# 结果(/opt/browser-channel:x86 装了真 Chrome→chrome,arm→bundled)。设为具体 channel
# 可强制覆盖。
if [[ -z "${APP_BROWSER_CHANNEL:-}" || "${APP_BROWSER_CHANNEL}" == "auto" ]]; then
  APP_BROWSER_CHANNEL="$(cat /opt/browser-channel 2>/dev/null || echo bundled)"
  export APP_BROWSER_CHANNEL
fi
echo "Resolved APP_BROWSER_CHANNEL=${APP_BROWSER_CHANNEL} (arch $(uname -m))"

# Remove stale Chromium singleton locks left behind when a previous container
# was killed without a clean browser shutdown. The persistent profile volume
# keeps these locks, which point at the old container's hostname/pid and make
# the new Chromium refuse to launch ("profile appears to be in use"). A fresh
# container never has a legitimate Chromium running yet, so clearing them here
# is safe.
find "${APP_USER_DATA_DIR}" \
  \( -name SingletonLock -o -name SingletonSocket -o -name SingletonCookie \) \
  -exec rm -f {} + 2>/dev/null || true

ACTIVE_DISPLAY="${ACTIVE_DISPLAY:-${APP_ACTIVE_DISPLAY:-:99}}"
IDLE_DISPLAY="${IDLE_DISPLAY:-${APP_IDLE_DISPLAY:-:100}}"
ACTIVE_VNC_PORT="${ACTIVE_VNC_PORT:-5900}"
IDLE_VNC_PORT="${IDLE_VNC_PORT:-5901}"
VNC_RESOLUTION="${VNC_RESOLUTION:-1366x768x24}"
ACTIVE_NOVNC_PORT="${ACTIVE_NOVNC_PORT:-10086}"
IDLE_NOVNC_PORT="${IDLE_NOVNC_PORT:-10087}"
APP_IDLE_NOVNC_SWITCH="${APP_IDLE_NOVNC_SWITCH:-false}"

export APP_ACTIVE_DISPLAY="${APP_ACTIVE_DISPLAY:-${ACTIVE_DISPLAY}}"
export APP_IDLE_DISPLAY="${APP_IDLE_DISPLAY:-${IDLE_DISPLAY}}"
export APP_IDLE_NOVNC_SWITCH
export DISPLAY="${APP_ACTIVE_DISPLAY}"

display_socket_number() {
  local display="$1"
  local number="${display#*:}"
  printf '%s' "${number%%.*}"
}

wait_for_display() {
  local display="$1"
  local socket_number
  socket_number="$(display_socket_number "${display}")"

  for _ in $(seq 1 100); do
    if [[ -S "/tmp/.X11-unix/X${socket_number}" ]]; then
      return 0
    fi
    sleep 0.1
  done

  echo "Timed out waiting for X display ${display}" >&2
  return 1
}

start_desktop() {
  local name="$1"
  local display="$2"
  local vnc_port="$3"
  local novnc_port="$4"

  Xvfb "${display}" -screen 0 "${VNC_RESOLUTION}" -nolisten tcp >"/tmp/${name}-xvfb.log" 2>&1 &
  wait_for_display "${display}"

  DISPLAY="${display}" fluxbox >"/tmp/${name}-fluxbox.log" 2>&1 &

  local x11vnc_args=(
    -display "${display}"
    -forever
    -shared
    -rfbport "${vnc_port}"
  )

  if [[ -n "${VNC_PASSWORD:-}" ]]; then
    x11vnc_args+=(-passwd "${VNC_PASSWORD}")
  else
    x11vnc_args+=(-nopw)
  fi

  x11vnc "${x11vnc_args[@]}" >"/tmp/${name}-x11vnc.log" 2>&1 &
  if [[ -n "${novnc_port}" ]]; then
    websockify --web=/usr/share/novnc "${novnc_port}" "127.0.0.1:${vnc_port}" >"/tmp/${name}-novnc.log" 2>&1 &
  fi
}

start_desktop active "${APP_ACTIVE_DISPLAY}" "${ACTIVE_VNC_PORT}" "${ACTIVE_NOVNC_PORT}"

idle_novnc_port="${IDLE_NOVNC_PORT}"
if [[ "${APP_IDLE_NOVNC_SWITCH}" =~ ^([Tt][Rr][Uu][Ee]|1|[Yy][Ee][Ss]|[Yy])$ ]]; then
  idle_novnc_port=""
fi

if [[ "${APP_IDLE_DISPLAY}" == "${APP_ACTIVE_DISPLAY}" ]]; then
  if [[ -n "${idle_novnc_port}" && "${idle_novnc_port}" != "${ACTIVE_NOVNC_PORT}" ]]; then
    websockify --web=/usr/share/novnc "${idle_novnc_port}" "127.0.0.1:${ACTIVE_VNC_PORT}" >/tmp/idle-novnc.log 2>&1 &
  fi
else
  start_desktop idle "${APP_IDLE_DISPLAY}" "${IDLE_VNC_PORT}" "${idle_novnc_port}"
fi

exec "$@"
