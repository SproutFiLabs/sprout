# Production image: one Bun process serves the built web app and API.
# Pinned base; no global installs; reproducible from clean source (generated ABIs
# are committed source files, so no Foundry/contract artifacts are required).
FROM oven/bun:1.3.14-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# Workspace manifests only, so dependency resolution is deterministic and cached.
FROM base AS deps
COPY package.json bun.lock ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
COPY scripts/package.json scripts/
RUN bun install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json tsconfig.base.json
COPY shared shared
COPY web web
RUN bun run --cwd web build

FROM base AS runtime
COPY package.json bun.lock ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
COPY scripts/package.json scripts/
RUN bun install --frozen-lockfile --production

# Runtime needs only shared + server source and the built web assets.
COPY shared/tsconfig.json shared/tsconfig.json
COPY shared/src shared/src
COPY server/tsconfig.json server/tsconfig.json
COPY server/src server/src
COPY --from=build /app/web/dist web/dist

# /data is owned by bun here for the no-volume case; a Railway volume overrides
# that ownership, so the entrypoint repairs it as root at startup and then drops
# to bun. The server process itself never runs as root.
RUN mkdir -p /data && chown -R bun:bun /data /app
COPY scripts/docker-entrypoint.sh /usr/local/bin/sprout-entrypoint
RUN chmod 0755 /usr/local/bin/sprout-entrypoint

ENV SPROUT_SERVE_WEB=1 \
    SPROUT_BIND=0.0.0.0 \
    PORT=4317 \
    SPROUT_DB_PATH=/data/sprout.sqlite

EXPOSE 4317
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||4317)+'/api/ready').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/sprout-entrypoint"]
CMD ["bun", "server/src/index.ts"]
