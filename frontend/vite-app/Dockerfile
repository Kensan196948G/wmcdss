# syntax=docker/dockerfile:1.7
# WMCDSS frontend production image — multi-stage build.
# Stage 1: build the Vite ESM bundle (vite-app/dist).
# Stage 2: serve via nginx with backend reverse proxy.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
# conf.d の外へ置く: conf.d/*.conf は nginx 既定設定が http コンテキストで
# 自動 include するため、そこへ置くと default.conf 内の明示 include と
# 二重に評価される。
COPY nginx-security-headers.conf /etc/nginx/security-headers.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1/ || exit 1
