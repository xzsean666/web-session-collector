FROM mcr.microsoft.com/playwright:v1.60.0-noble

ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    dbus-x11 \
    fluxbox \
    fonts-noto-cjk \
    novnc \
    websockify \
    x11vnc \
    xvfb \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable \
  && corepack prepare pnpm@10.12.1 --activate \
  && pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build \
  && pnpm prune --prod

COPY docker/entrypoint.sh /usr/local/bin/web-session-collector-entrypoint
RUN chmod +x /usr/local/bin/web-session-collector-entrypoint \
  && mkdir -p /data/chrome-user-data

ENV DISPLAY=:99
ENV ACTIVE_DISPLAY=:99
ENV IDLE_DISPLAY=:100
ENV VNC_RESOLUTION=1366x768x24
ENV ACTIVE_VNC_PORT=5900
ENV IDLE_VNC_PORT=5901
ENV ACTIVE_NOVNC_PORT=10086
ENV IDLE_NOVNC_PORT=10087
ENV APP_IDLE_NOVNC_SWITCH=true
ENV APP_SITE=xiaohongshu
ENV APP_USER_DATA_DIR=/data/chrome-user-data
ENV APP_PROFILE_NAME=docker-xiaohongshu
ENV APP_BROWSER_MODE=launch
ENV APP_HEADLESS=false
ENV APP_BROWSER_CHANNEL=bundled
ENV APP_EXECUTABLE_PATH=
ENV APP_PROFILE_DIRECTORY=Default
ENV APP_LOCALE=zh-CN
ENV APP_TIMEZONE_ID=Asia/Shanghai
ENV APP_VIEWPORT_WIDTH=1366
ENV APP_VIEWPORT_HEIGHT=768
ENV APP_DEVICE_SCALE_FACTOR=1
ENV APP_START_URL=https://www.xiaohongshu.com/
ENV APP_LOG_LEVEL=info
ENV APP_KEEP_BROWSER_ALIVE=false
ENV APP_INTERACTIVE_LOGIN_ON_MISSING_USER=false
ENV APP_BROWSER_FLAGS='["--no-first-run","--no-default-browser-check","--disable-dev-shm-usage","--no-sandbox"]'
ENV APP_IGNORE_DEFAULT_ARGS='[]'
ENV APP_API_HOST=0.0.0.0
ENV APP_API_PORT=10085
ENV APP_ACCOUNT_CHECK_INTERVAL_MS=60000
ENV APP_SEARCH_RECENT_DAYS=30
ENV APP_SEARCH_LIMIT=10
ENV APP_SEARCH_SCROLLS=2

EXPOSE 10085 5900 10086 10087

ENTRYPOINT ["web-session-collector-entrypoint"]
CMD ["pnpm", "run", "start:api"]
