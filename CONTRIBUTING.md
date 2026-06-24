# Contributing to Aperture

Aperture is a collaborative wormhole-mapping web app for EVE Online, built on Next.js +
TypeScript + Drizzle + Postgres. This guide covers getting a local dev environment running and
the conventions every change must follow.

If you've never opened the repo before, read these first:

1. [README.md](README.md) — what the app is and how to deploy it
2. [CLAUDE.md](CLAUDE.md) — the architectural rules (stack, database, realtime, auth) and the
   companion-`.md` convention

---

## Local development

### Prerequisites

- **Node 24+**
- **pnpm 9+** (`corepack enable` will provision it)
- **Docker** (for the Postgres 18 container)

### Setup

```bash
pnpm install
cp .env.example .env          # fill in the values — see below
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db   # Postgres 18 (pgcrypto + pg_partman), published to localhost:5432
pnpm db:migrate               # apply Drizzle migrations
pnpm dev                      # http://localhost:3003
```

`pnpm dev` runs the custom entrypoint (`server.ts` via `tsx watch`), which serves the Next.js
app, the WebSocket server, and the background worker in **one process** on port **3003**.

For a working login you need EVE SSO OAuth2 credentials (`AUTH_EVE_CLIENT_ID` /
`AUTH_EVE_CLIENT_SECRET`) from <https://developers.eveonline.com>, plus `AUTH_SECRET`,
`ESI_TOKEN_ENC_KEY`, and `SETUP_PASSWORD`. See the env table in [README.md](README.md#required-environment)
and [`.env.example`](.env.example).

After the first run, open `/setup`, unlock with `SETUP_PASSWORD`, and trigger the SDE
static-data ingest from the operator console (it is not run by migrations).

### Checks before opening a PR

All three must be green:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Some integration tests hit a live dev database and are opt-in via `RUN_DB_TESTS=1`; they run
against the Docker Postgres above and snapshot/restore the rows they touch.

---

## Conventions

These are not optional — they come from [CLAUDE.md](CLAUDE.md). PRs that violate them won't merge.

### Companion `.md` files

Every `.ts` / `.tsx` file has a companion `.md` at the same path with the same base name,
created or updated **in the same commit** as the source change. These are a cheap, always-current
index of the codebase. The format is documented in [CLAUDE.md](CLAUDE.md) under "Companion `.md`
files — Standing Instruction". This is the single most-likely-to-be-forgotten rule.

### Stack

- Next.js 16 App Router · React 19 · TypeScript · Drizzle ORM · Postgres 18 · Auth.js v5 · Node 24 LTS
- **No Redis.** Sessions are stateless JWT; the queue is `graphile-worker`; realtime fanout is
  Postgres `LISTEN/NOTIFY`; hot caches are in-process LRU.
- UI: shadcn/ui, TanStack Table, Tiptap, sonner. Map canvas: **xyflow** — never jsPlumb.

### Database

- Single Postgres database, single schema.
- User-data tables use the `ap_` prefix; static CCP-data tables use `universe_`. No exceptions.
- `snake_case` columns; `camelCase` on the TS side via Drizzle's `name:` mapping.
- All time columns are `timestamptz`. JSON is `jsonb`. EVE IDs are `bigint`.
- Small lookups are `pgEnum`s, not tables. Cross-domain joins use real foreign keys.

### Three mutation pathways

Pick one per change; don't invent a fourth:

| Trigger | Mechanism |
|---|---|
| User clicked / typed in the UI | Server Action *or* JSON API route |
| Server observed something external | Background job → DB write → `ap_map_event` insert → `pg_notify` → WS push |
| Cross-tab fan-out of either above | WebSocket server → client only |

The WebSocket is **broadcast-only** — clients never mutate over it.

### Shared types

All domain types live in `src/types/index.ts`. Don't define project-domain types inline in
components or services. DB-derived types use Drizzle's `InferSelectModel` / `InferInsertModel`.

### Code style

- Don't add features, refactor, or introduce abstractions beyond what the task requires.
- Comments explain *why* (constraints, invariants, workarounds), never *what*.
- Trust internal code; validate only at system boundaries (user input, external APIs / ESI).

---

## Git workflow

- Branch from `master`; one logical change per branch.
- Keep PRs reviewable in a single sitting, with a green CI build (`pnpm typecheck`, `pnpm lint`,
  `pnpm test`) and companion `.md` updates alongside the code.
- Don't force-push to `master`; don't skip CI hooks.

For larger work that spans multiple sessions, write a staged plan to `docs/plans/<feature>.md`
following the format in [CLAUDE.md](CLAUDE.md) § Planning Mode.
