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

Every change starts from an issue, not a blank branch. If nothing covers what you want to do,
[open one](../../issues/new/choose) first — the templates ask for acceptance criteria, likely
files, and out-of-scope notes, which is also what an AI coding tool needs to work the issue
unattended.

1. **Assign yourself** to the issue (keeps two people from picking up the same one).
2. **Branch from it:**
   ```bash
   gh issue develop <issue-number> --base dev
   git checkout <the branch gh just created>
   ```
   This links the branch to the issue from the start, which survives even if an AI tool
   later rewrites the PR body. Never branch off `master` — CI rejects any PR targeting it;
   `master` only advances by merging `dev` at release time, see
   [docs/RELEASING.md](docs/RELEASING.md).
3. **Point your AI tool at the issue** — `gh issue view <issue-number>` gives it the spec.
   `AGENTS.md` at the repo root carries the working conventions every AI tool should already
   be reading.
4. **Open the PR against `dev`**, include `Closes #<issue-number>` in the description (a bot
   will try to infer and inject this if you forget, but don't rely on it), and click
   **Enable auto-merge**. Once `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green — plus
   the size/scope/dependency gates in `.github/workflows/pr-gates.yml` — it merges on its own.
   A PR touching `src/lib/auth/`, `src/lib/esi/`, or `src/db/schema|migrations/` additionally
   needs a maintainer review (see `.github/CODEOWNERS`).

Keep PRs reviewable in a single sitting — one logical change per branch, companion `.md`
updates alongside the code, no drive-by refactors outside the issue's scope. Don't force-push
to `master`; don't skip CI hooks.

For larger work that spans multiple sessions, write a staged plan to `docs/plans/<feature>.md`
following the format in [CLAUDE.md](CLAUDE.md) § Planning Mode.

### Project board

Every issue moves through five statuses on the maintainer project board, driven entirely by
GitHub events — nobody drags cards by hand:

| Status | Set automatically when... |
|---|---|
| **Backlog** | An issue is opened |
| **In Progress** | The issue is assigned |
| **Pending Dev** | A non-draft PR closing the issue is opened against `dev` |
| **Dev Testing** | That PR is merged into `dev` |
| **Done** | `dev` is merged into `master` (a release) — every issue in "Dev Testing" moves to "Done" at once |

See `.github/workflows/issue-opened.yml`, `issue-assigned.yml`, `project-status-sync.yml`, and
`release-to-master.yml`.
