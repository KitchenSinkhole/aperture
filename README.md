# Aperture

#### Wormhole mapping tool for [EVE Online](https://www.eveonline.com)

Aperture is a collaborative, real-time wormhole-mapping web app for EVE Online. Corps and
alliances chart short-lived wormhole chains together: shared maps update live across every
viewer, signatures and D-Scan results paste straight in from the in-game clients, and tracked
characters move on the map on their own as they jump — no manual position-keeping.

What it does:

- **Shared live maps** — every system, connection, and signature edit fans out to all
  viewers over a WebSocket the moment it commits. Many tabs for one character share a single
  socket; a degraded-mode banner shows if realtime ever falls behind.
- **Signature & D-Scan paste** — paste the in-game probe-scanner or D-Scan dump and Aperture
  resolves cosmic-signature groups and wormhole types, auto-links connections, and ages out
  stale signatures.
- **Server-side character tracking** — location polling runs as a background job per tracked
  character, so jumps appear on the map even when no tab is open. New systems are placed in an
  open slot next to the system they were reached from.
- **Wormhole lifecycle** — EOL and mass states, automatic expiry, and a derived per-connection
  mass log built from observed jumps.
- **Corp/alliance access control** — opt-in allowlist login, per-corp map scoping, and an
  admin console at `/setup` for first-run operator setup.

> Aperture began as a ground-up rebuild of the Pathfinder wormhole mapper; the legacy PHP app
> is preserved at the [`legacy-archive`](../../tree/legacy-archive) tag. Aperture shares none
> of its code.

### Stack

- **Next.js 16** App Router · **React 19** · **TypeScript**
- **Drizzle ORM** · **Postgres 18**
- **Auth.js v5** with EVE SSO
- **xyflow** map canvas · **shadcn/ui** · **Tiptap**
- **graphile-worker** background jobs · Postgres `LISTEN/NOTIFY` realtime — **no Redis**

The WebSocket server, background worker, and Next.js app all run in **one Node process** via a
custom entrypoint (`server.ts`), served on port **3003** by default.

### Run locally

Requires Node 24+, pnpm 9+, and Docker.

```bash
pnpm install
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db   # Postgres 18 (pgcrypto + pg_partman), port published to localhost
pnpm dev                  # http://localhost:3003
```

The base `docker-compose.yml` does **not** publish Postgres to the host — that's the
production posture (the DB is reachable only over the compose network). The
`docker-compose.dev.yml` overlay re-publishes it on `127.0.0.1:5432` so a locally-run
`pnpm dev` can connect; you must pass it explicitly.

Copy `.env.example` to `.env` and fill in the values (see below) before `pnpm dev`. Other
scripts: `pnpm typecheck`, `pnpm lint`, `pnpm test`. Full contributor setup is in
[CONTRIBUTING.md](CONTRIBUTING.md).

### Deployment

The committed [`docker-compose.yml`](docker-compose.yml) is the production path. It builds the
app image, runs database migrations as a one-shot `migrate` service, and starts the app
(`NODE_ENV=production`) on port **3003**, all against a `pg_partman`-enabled Postgres 18:

```bash
cp .env.example .env      # fill in real secrets (see below)
docker compose up -d      # builds db + runs migrations + starts app on :3003
```

This bare `docker compose up -d` does not include `docker-compose.dev.yml`, so Postgres is
**never published to the host** in production — only the `app` and `migrate` services reach
it over the internal compose network. Only port **3003** (the app) is exposed.

Migrations run on every `up` and are idempotent.

#### Static data (SDE)

Migrations create the `universe_*` tables but leave them empty. **The SDE ingest is never run
automatically**, not on the first deploy and not on an upgrade.

**First deploy.** Open `/setup`, unlock with `SETUP_PASSWORD`, and run **Re-ingest current
build**. That populates `universe_*` from the pinned bootstrap build and takes several minutes;
`ap_job_run` shows progress. From a shell on the host, `pnpm sde:bootstrap` does the same thing.

Use that card, not **Refresh to latest**, for the first ingest. Refresh only acts when FC's
latest build is newer than the one this database records, so if the two happen to match it
decides there is nothing to do and leaves the tables empty.

**After that it keeps itself current.** The `sde-refresh` job runs daily at 12:15 UTC, compares
FC's published build against `ap_sde_state`, and ingests a newer one when it appears. A build
that fails validation is rejected whole, so the database keeps serving the build it already has.
Static data that has fallen behind, or a refresh that keeps failing, raises a banner for every
user; `/setup` carries the operator detail and a **Refresh to latest** card to run the check on
demand.

**Upgrading a deployment older than the self-refresh job.** Run **Re-ingest current build** once
after the deploy. `ap_sde_state` records which build the database holds, and a database populated
before that table existed carries no record of its build, so the first refresh check seeds it
from the pinned build without being able to verify that claim. Until something is actually
ingested, the recorded build is a guess: if FC's latest matches the pin at that moment, the
check reports current and no banner appears while the data on disk is genuinely older. One
manual ingest replaces the guess with the truth, and every later upgrade is fine.

If you reach for `pnpm sde:bootstrap` instead and it fails saying the build is older than the one
the database holds, that is the downgrade gate doing its job: the refresh has already moved past
the pinned build and no action is needed.

#### Required environment

See [`.env.example`](.env.example) for the full list.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. |
| `AUTH_SECRET` | `openssl rand -base64 32`. Used by Auth.js and to sign internal short-TTL cookies (`ap_link`, `ap_setup`). |
| `AUTH_EVE_CLIENT_ID` / `AUTH_EVE_CLIENT_SECRET` | EVE SSO OAuth2 credentials. |
| `ESI_TOKEN_ENC_KEY` | 32 random bytes (base64). Encrypts ESI access/refresh tokens at rest. |
| `SETUP_PASSWORD` | Gates the `/setup` operator console. Pick a long random string; rotating it invalidates active unlock cookies. |

The wizard at `/setup` deliberately bypasses EVE SSO so an operator can recover from a broken
auth deploy. The floor under that bypass is the in-app `SETUP_PASSWORD` check, which mints a
signed, 4-hour `ap_setup` cookie. A deployment with `NODE_ENV=production` and an empty
`SETUP_PASSWORD` fails fast at import.

**Defense in depth (optional).** Operators MAY front `/setup` with proxy-level auth (nginx
Basic, Cloudflare Access, etc.); the app gate is the floor, and the deployment is safe without
it provided `SETUP_PASSWORD` is set.

### Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup and conventions, and
[CLAUDE.md](CLAUDE.md) for the architectural rules.

### Licence

[MIT](http://opensource.org/licenses/MIT)
