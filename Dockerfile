# syntax=docker/dockerfile:1

# Aperture runs through a custom Node entrypoint (server.ts via tsx) so the
# WebSocket upgrade handler and graphile-worker share one process with the
# Next.js app (SPEC §5.5). Consequences for this image:
#   - The runtime keeps the FULL dependency tree: `pnpm start` is `tsx server.ts`
#     and tsx is a devDependency. No `--prod` prune.
#   - The runtime keeps the TS source: server.ts dynamically imports
#     @/lib/realtime/wsServer and @/lib/jobs/runner, which tsx compiles on the
#     fly. So there is no `next start` / `output: standalone` path.

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

# ---- deps: full dependency install, cached on the lockfile ----
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- build: produce the .next output ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `next build` forces NODE_ENV=production, which trips env.ts's production
# secret-gate at import time. These are throwaway placeholders that satisfy
# that validation only — they are never read at runtime (the runner stage gets
# real values from compose) and are not inlined into any client bundle (none
# are NEXT_PUBLIC_*). The encryption key is validated lazily, not at import, so
# a non-key string is fine here.
ENV NODE_ENV=production \
    AUTH_SECRET=build \
    AUTH_EVE_CLIENT_ID=build \
    AUTH_EVE_CLIENT_SECRET=build \
    ESI_TOKEN_ENC_KEY=build \
    SETUP_PASSWORD=build
RUN pnpm build

# ---- runner: Next app + worker + WS in one process ----
FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
# Config + source tsx needs to compile server.ts and its transitive imports at
# runtime, plus the migration SQL that `pnpm db:migrate` applies.
COPY package.json pnpm-lock.yaml tsconfig.json next.config.ts aperture.config.ts drizzle.config.ts server.ts ./
COPY src ./src
COPY public ./public
COPY scripts/data ./scripts/data
EXPOSE 3003
CMD ["pnpm", "start"]
