# 构建前端静态产物
FROM docker.m.daocloud.io/oven/bun:1.3.13 AS web-build

WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile --cache-dir=/root/.bun/install/cache
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY web ./
RUN bun run build

# 构建 Go 后端
FROM docker.m.daocloud.io/golang:1.22-bookworm AS backend-build

WORKDIR /app/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend ./
RUN CGO_ENABLED=1 go build -o /app/server ./cmd/server

# 运行镜像：Go 后端 + 静态前端
FROM docker.m.daocloud.io/debian:bookworm-slim

WORKDIR /app
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources && \
    apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=backend-build /app/server /app/server
COPY --from=web-build /app/web/dist /app/web/dist
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md

ENV GIN_MODE=release
EXPOSE 3040

CMD ["/app/server"]
