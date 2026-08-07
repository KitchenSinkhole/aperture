# Aperture — Claude Code Working Notes

Aperture is a collaborative, real-time wormhole-mapping web app for EVE Online, built on Next.js + TypeScript + Drizzle + Postgres. Corps and alliances chart short-lived wormhole chains together — shared maps update live across every viewer, signatures and D-Scan paste in from the in-game clients, and tracked characters move on the map as they jump.

The companion `.md` files (see below) are the index of the codebase: read them first, open source only to modify it.

---

## How to Find Things

| I want to understand... | Start with... |
|---|---|
| Shared TS types | `src/types/index.md` |
| Drizzle schema (tables, enums, FKs) | `src/db/schema.md` |
| Database migrations | `src/db/migrations/` (Drizzle Kit) |
| Auth.js EVE SSO provider + token rotation | `src/lib/auth.md` |
| ESI client (circuit breakers, Zod decoders) | `src/lib/esi/client.md` |
| Background jobs (graphile-worker) | `src/lib/jobs/runner.md`, `src/lib/jobs/registry.md` |
| Server-side character location tracking | `src/lib/jobs/tasks/locationPoll.md` |
| Realtime fanout (`pg_notify` ↔ WebSocket) | `src/lib/realtime/bus.md` |
| WebSocket server (custom Node `server.ts` upgrade handler) | `src/lib/realtime/wsServer.md`, `server.md` |
| Browser SharedWorker WebSocket client | `src/lib/realtime/sharedWorker.md` |
| Client realtime provider + degraded banner | `src/lib/realtime/useRealtime.md`, `src/components/RealtimeStatusBanner.md` |
| Map engine (xyflow) | `src/components/map/MapCanvas.md` |
| Map mutation pathways (Server Actions / API) | `src/app/api/map/README.md` |
| Webhook fan-out (Slack / Discord) | `src/lib/webhooks/dispatcher.md` |
| SDE / ESI static-data ingest | `src/lib/sde/ingest.md`, `src/lib/jobs/tasks/sdeIngest.md` |

---

## Development Conventions

### Companion `.md` files — Standing Instruction

**This is a standing instruction that applies to every file edit in this project, without exception:**

> Whenever you create or modify a `.ts` or `.tsx` file, you must keep its companion `.md` **accurate** in the same operation — which frequently means making **no change at all**. If no companion exists yet, create it. Use the formats defined below.

Every `.ts` and `.tsx` source file in the codebase has a companion `.md` file at the same path with the same base name. These files serve as a cheap, always-current index of the codebase for Claude Code. Rather than reading entire source files to understand relationships and interfaces, Claude Code reads the `.md` files first and only opens the source when it actually needs to modify it.

```
src/
├── components/
│   ├── map/
│   │   ├── MapCanvas.tsx
│   │   ├── MapCanvas.md          ← companion
│   │   ├── SystemNode.tsx
│   │   ├── SystemNode.md
├── lib/
│   ├── esi/
│   │   ├── client.ts
│   │   ├── client.md
│   ├── realtime/
│   │   ├── bus.ts
│   │   ├── bus.md
```

Companion files are maintained by Claude Code as a standing instruction. They are never edited by hand and require no external script or API call. The companion must be written or updated **before** the edit is considered complete.

#### The companion indexes current state — it is not a changelog

The companion describes what a module **is and does right now**: its interface (props, exports, emits, dependencies) and its non-obvious behaviours. It is **not** a record of what changed or why. Before touching a companion, apply this gate:

- **Did the documented interface or an externally-observable behaviour change?** — props, exports, emitted events, dependencies, what it renders, a user-visible behaviour. If yes, update the affected section. If the change is purely internal — a refactor, a bug fix that restores already-documented behaviour, a performance tweak, a styling change — the companion needs **no edit**; confirming it still reads accurately satisfies the standing instruction. Do not manufacture an edit to show work.

When an edit *is* warranted, still apply the rules below **line by line**: a legitimate update (e.g. a changed prop list) must not smuggle in a clause whose only job is to explain the change. Most of the bloat this prevents rides along inside otherwise-valid edits, not in wholesale unnecessary ones.

**Never put these in a companion** — they belong in a code comment or the commit message, not the index:
- **Change-rationale / justification** — *why* a line is the way it is, what bug it fixes, what it works around. This bans **change**-rationale (why it differs from a previous version, what prompted the change), **not** a non-obvious **invariant or guarantee the current code upholds** — a security check ("a foreign system 404s so a viewer can't harvest another map's sigs"), an ordering or mass-balance constraint. State the invariant in the present tense; drop the story of how it came to be.
- **History** — "previously X, now Y", "no longer does Z", "moved from the dialog", anything that only makes sense as a diff. A temporal word in a description (*no longer, now, still, used to, was, moved to*) is the smell — rewrite in plain present tense stating only what is true now.
- **Implementation strings** — exact Tailwind class lists, CSS values, `color-mix(...)` / colours, magic numbers. Name the behaviour ("sticky, opaque header"), not its spelling in code; the source carries the literal value.
- **Cross-references as rationale** — "matches `OtherModule`".

**The test:** would the line read identically if the code had always been written this way? If a sentence only makes sense as the explanation of a *change*, it does not belong in the index.

**Schema companions (`src/db/schema/**`) — provenance exception:** a schema `.md` may cite the migration that established a column or constraint as bare provenance (e.g. `(migration 0015)`), since it aids navigating the migration history. It must still drop the justification tail and temporal framing — `replaced the prior group_id FK to universe_group (migration 0015), which couldn't represent the cosmic six` becomes `the seven keys the probe scanner emits (migration 0015)`.

#### For `.tsx` component files

```markdown
## ComponentName

**Purpose:** One sentence describing what this component does.
**File:** `src/components/ComponentName.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| propName | string | yes | What it controls |
| onSave | (m: MapSystem) => void | yes | Called when the inspector commits |
| isVisible | boolean | no | Defaults to true |

### Renders
Brief description of what the component produces visually.

### Behaviour & Interactions
- Bullet list of non-obvious behaviours, state transitions, or side effects
- e.g. "Position changes are debounced 200ms before firing the mutation"
- e.g. "Switching system status optimistically updates the local cache before the server confirms"

### Emits / Calls
- `onSystemChange(system)` — fired on every committed field change
- `useRealtimeBus()` — subscribes to `map:<id>` envelopes from context

### Depends On
- `SystemStatusPicker` — enum dropdown bound to `system_status`
- `IntelNotesEditor` — Tiptap-backed rich text input

### Local State
- `editingAlias: boolean` — whether the alias field is in edit mode
```

Omit any section that has nothing to say.

#### For `.ts` module files

```markdown
## moduleName.ts

**Purpose:** One sentence describing the module's responsibility.
**File:** `src/lib/moduleName.ts`

---

### functionName(param: Type, param2: Type): ReturnType
What this function does. Any side effects, error conditions, or performance notes.

**Parameters:**
- `param` — what it is
- `param2` — what it is

**Returns:** What the return value represents.

---

### anotherFunction(...)
...
```

Document only exported symbols. Omit internal helpers.

### Types
All shared domain types live in `src/types/index.ts`. Do not define project-domain types inline in components or services — add them to `index.ts` and import from there. Database-derived types are inferred from the Drizzle schema (`InferSelectModel` / `InferInsertModel`) and re-exported from `src/types/index.ts`.

---

## Stack & Architectural Rules

Treat these as load-bearing — deviations need an explicit reason recorded in a plan doc.

### Stack
- **Next.js 16+ App Router**, **React 19**, **TypeScript 6+**, **Drizzle ORM**, **Postgres 18**, **Auth.js v5**, **Node 24 LTS**.
- **No Redis.** Sessions are stateless JWT. Background queue is Postgres-backed (`graphile-worker`). Realtime fanout is Postgres `LISTEN/NOTIFY`. Hot caches are in-process LRU.
- UI primitives: **shadcn/ui**, **TanStack Table**, **Tiptap**, **sonner** (toasts). Map canvas: **xyflow (react-flow)** — do **not** reach for jsPlumb or imperative DOM map libraries.

### Database
- **Single Postgres database, single schema.**
- **Table-name prefixes are mandatory, no exceptions:** every user-data table starts with `ap_`; every static CCP-data table starts with `universe_`.
- **Column casing:** `snake_case` in the DB, `camelCase` on the TS side via Drizzle's `name:` mapping.
- **All time columns are `timestamptz`.** No naked `timestamp`.
- **IDs:** `generated always as identity` (or `bigserial` where natural). EVE IDs are 64-bit — use `bigint`.
- **JSON:** always `jsonb`, never `json`.
- **Small lookup tables become `pgEnum`s** (e.g. `map_scope`, `system_status`, `connection_scope`, `wh_mass`, `authz_level`). Don't introduce a lookup table when an enum will do.
- **Real foreign keys across the `ap_` / `universe_` boundary.** `ap_map_system.system_id → universe_system.id` is a normal FK with `ON DELETE RESTRICT`. No application-level joins for what should be SQL.
- **Audit `character_id` is `ON DELETE SET NULL`.** Erasing a character must not cascade-wipe their map/system/connection history.

### Mutation pathways (one canonical commit point per change)
There are exactly three pathways. Pick the right one; do not invent a fourth.

| Trigger | Mechanism |
|---|---|
| User clicked / typed in the UI | Server Action *or* JSON API route |
| Server observed something external | Background job → DB write → `ap_map_event` insert → `pg_notify` → WS push |
| Cross-tab fan-out of either above | WebSocket server → client only |

- The **WebSocket is broadcast-only.** Clients never send mutations over it.
- Every mutation lands as exactly **one `INSERT INTO ap_map_event`**. An `AFTER INSERT` trigger emits `pg_notify('map:'||map_id, …)`. The WS handler picks it up. No application-level dual-write.
- **Server Actions** for low-traffic state changes where a fresh render is the natural next step (account settings, map create/delete, admin settings).
- **JSON API routes** for high-frequency client-initiated mutations (signature edits, system drag, connection type change).

### Realtime
- **Native WebSocket served by the same Next.js deployment.** Not a separate process.
- **Postgres `LISTEN/NOTIFY`** is the only fanout mechanism. The channel the `ap_map_event` trigger publishes to is the channel the WS handler subscribes to. Job dispatch uses the same mechanism.
- **SharedWorker** on the browser — one character with many tabs holds exactly **one** socket.
- Task vocabulary is fixed: `mapUpdate`, `mapAccess`, `mapConnectionAccess`, `mapDeleted`, `characterUpdate`, `characterLogout`, `healthCheck`, `logData`, `systemNotification`, `connectionMassLog`, `publicUpdate`, plus client→server `subscribe` / `unsubscribe`. Don't invent new task names. `systemNotification` is a transient server-observed system event (e.g. a zKillboard kill in an on-map system) — like `characterUpdate` it is broadcast by a direct `pg_notify` that bypasses `ap_map_event`. `connectionMassLog` is the same pattern for a server-derived per-jump connection mass-log entry. `publicUpdate` is a coarse, data-free "something changed" nudge sent only to token-authed public spectator sockets (a share token pins the socket to one map at upgrade, separate from session auth) — the client refetches the redacted snapshot rather than trusting anything on the wire.
- If realtime is unhealthy, the UI **must** surface a degraded-mode banner — never silently render stale state.

### Background jobs
- Single Node job runner backed by **`graphile-worker`**. No Redis.
- **Character location tracking runs server-side**, one job per tracked character — never coupled to a tab being open.
- Polling cadence is adaptive on `online` state; intervals are **hard-coded constants** (`LOCATION_POLL_ONLINE_MS`, `LOCATION_POLL_OFFLINE_MS`), not a runtime knob.

### Auth & ESI
- **Auth.js v5** with a custom **EVE SSO** OAuth2 provider.
- **ESI tokens live on `ap_character`** (`esi_access_token`, `esi_refresh_token`, `esi_access_token_expires`, `esi_scopes`). Tokens are **encrypted at rest** (pgcrypto or app-layer AEAD).
- **Refresh-token rotation is persisted on every token exchange**, *before* the new access token is consumed by any caller. Cover it with an integration test.
- **JWK cache:** fetch on cold start, refresh on signature failure, capped at one re-fetch per 10s.
- **Per-endpoint circuit breakers** on ESI. Treat the CCP downtime window (`±8m` around `CCP_SSO_DOWNTIME`) as expected.
- **All ESI responses go through Zod decoders.** ESI schema drift must surface as a decoder error, not a silent `undefined` cascade.
- **Access control is opt-in.** Login is restricted-by-default: a character may sign in only if it (or its corp/alliance) is on the allowlist (`ap_access_grant` rows, `scope='instance'`, `capability='login'`), or it belongs to an `ap_instance_owner` entity (you can't lock yourself out of your own deployment).
- **Director ⇒ corp manager, never global admin.** Any EVE corp Director resolves to `authz_level='manager'` — a **corp-scoped** admin over their own corp's maps only — regardless of instance ownership. Global `admin` comes **only** from an explicit hand-granted `ap_access_grant` (`capability='admin'`); nothing derives it. `ap_character.authz_level` is a recomputed cache: `syncCharacterAuthz` writes the max of (explicit grants, Director⇒manager, else member) every pass. See `src/lib/auth/rights.md` and `resolveAuthz.md`.
- **Admin gating** reads the `ap_character.authz_level` enum, not a second Auth.js provider.
- **Kick / ban orphaning:** kick/ban status lives on `ap_character.status` and is cascade-removed with the account (`ap_character` → `ap_user` is `ON DELETE CASCADE`). A player returning under a new account on the same character lands with `status='active'`; the prior kick/ban does not revive.
- **`/setup` ops console:** bypasses EVE SSO and is gated by `SETUP_PASSWORD` (`.env`) + a signed short-TTL `ap_setup` cookie (`src/lib/auth/setup-cookie.ts`). Operators may layer proxy auth in front for defense in depth. Production deploys with empty `SETUP_PASSWORD` fail fast at import.

### Config
- Env vars + a typed `aperture.config.ts` for app constants. No `.ini`-style config files.
- Do not gate behavior on runtime config that should be a hard-coded constant (see job cadences above).

### Lifecycle patterns
- **Do not add a generic `active` boolean** to operational tables. Pick the right mechanism per case:
  - `ap_map_system.visible` for "currently shown on the map" (rows persist across invisibility cycles).
  - `ap_map.deleted_at` for two-phase map deletion (30-day grace, then purge).
  - **Hard-delete** for `ap_map_connection` — wormholes collapse and don't come back.
  - Status enums (`character_status`, etc.) where a state machine is the real model.
- **History lives in `ap_map_event`**, partitioned monthly. Never write NDJSON history files. Never dual-write to a parallel audit table.

### Code style
- Don't add features, refactor, or introduce abstractions beyond what the task requires.
- Don't write comments that explain *what* the code does — naming should carry that. Comments are for non-obvious *why*: a constraint, an invariant, a workaround for a specific bug.
- Trust internal code and framework guarantees; validate only at system boundaries (user input, external APIs / ESI).
- No backwards-compatibility shims for old URL shapes, cookie formats, or DB columns.

---

## Planning Mode

If a task is too large to complete in a single session, **do not try to power through it.** Write a staged plan instead, and run each stage in its own fresh session.

The plan file is the **handoff between sessions**, and that is the point of the whole ritual: a stage starts from the previous stage's conclusions rather than from its dead ends, rejected approaches, and accumulated noise. Everything below exists to keep that handoff honest.

A plan has real overhead. It pays for work that genuinely spans sessions; for a one-file fix, writing the plan costs more than the fix. Don't reach for it below that bar.

### Authoring a plan

1. Write the plan to `docs/plans/<feature-name>.md`. Each stage must be independently executable and end at a natural checkpoint (a passing test, a green build, a working but feature-flagged path).
2. **Planning itself may take more than one session, and often should.** Context rot degrades a planning session exactly as it degrades an execution session, and what suffers first is the overarching design — the thing this session exists to get right. So when a single stage carries a large sub-design of its own (a whole UI surface, a schema redesign, a protocol), do **not** cram it in alongside. Mark the stage `**Design pass:** <what needs designing>`, finish the rest of the skeleton, and hand off. Each marked stage then gets its **own fresh planning session**, which designs only that stage, writes the result back into the plan (splitting it into sub-stages where warranted, filling in `Mode` / `References` / `Touches` / `Done when`), and deletes the marker. A design pass writes to `docs/plans/` and nothing else. **Execution begins only once no `Design pass` markers remain.**
3. **Label the mode** each stage should be started in:
   - **`Plan mode`** — the user reviews an approach before any file is written.
   - **`Accept edits`** — mechanical execution against a clear, already-agreed spec (e.g. "translate this Drizzle schema into migration files", "wire up these props to the existing context"). The user isn't prompted for every write.

   **A stage carries `Plan mode` into execution only when it needs to see something that does not exist yet** — a file format an earlier stage will fetch, the real shape of an external response, code a prior stage will restructure. Anything designable against the code as it stands today is settled *before* execution by a design pass, never deferred into the run. "This stage is intricate" argues for a design pass or a smaller stage; on its own it is not a reason to stop a run. Each surviving `Plan mode` stage halts execution and waits for the user, so front-load them and merge adjacent ones touching the same code into one session.
4. **Size stages by quality, not by capacity.** Target a stage that finishes in roughly half a context window, not one that barely fits — reasoning degrades well before the window fills, and a stage that runs to 70% has already lost something in its final third. Smells that a stage is too big: it touches more than five or six files, its **Done when** mixes clauses of different kinds, or its goal can't be stated in one sentence without an "and".
5. **Give each stage its own `References`.** A stage session should load exactly the companions it will touch, not the whole feature's reading list.
6. **Pin the boundary, not the method.** `Goal`, `Touches` and `Done when` are the stage's contract and must be unambiguous. Beyond that, be sparing with prescribed implementation — a schema shape or an agreed design decision is fair, step-by-step logic is not. The code will have moved by the time a later stage runs, and a session given the goal handles that better than one holding a stale recipe.
7. After writing the plan file, tell the user:
   - The plan is at `docs/plans/<feature-name>.md`.
   - **Which stages carry a `Design pass` marker**, if any — each needs its own fresh planning session, and execution shouldn't start until all are cleared.
   - **They should start a new session for each stage** (a fresh context window keeps each stage focused).
   - For each session: open the plan, read the stage, then enter the mode the stage specifies (`Shift+Tab` cycles between Plan mode and Accept-edits mode), and tell Claude to execute that stage.

### Executing a stage

The stage is the scope: don't drift into later stages, and don't fix unrelated things you notice along the way. Before reporting a stage complete:

1. **Reconcile the downstream stages.** Re-read every stage after this one and edit the ones this stage invalidated. A plan is authored with the least information anyone will ever have about the problem, so a stage that discovers its successor can't be built as specified must say so **in the file**, not in chat. This is a required step, not a courtesy. Resizing counts: a downstream stage that now looks too big should be split here, or marked `**Design pass:**` if splitting it properly needs a session of its own.
2. **Append non-obvious findings to `## Notes`** at the foot of the plan: a rejected approach and why, a constraint found the hard way, a dev-DB quirk. Nothing the diff, a companion `.md`, or the commit message already carries — this section rots the same way a bloated companion does.
3. **Record what landed.** Fill in `**Landed:**` with the stage's commit sha. When a later stage misbehaves, the first question is whether an earlier one delivered its contract.
4. **Don't self-certify.** Run the mechanical gate (the `ci-verifier` agent), then tell the user to review the stage from a fresh session before starting the next one. The session that wrote the code is the worst available reviewer of it: it can't see the failure modes its own approach implies.

### Plan file shape

```markdown
# <Feature Name>

**Goal:** One sentence.
**References:** CLAUDE.md rules and companion `.md` files that apply across the whole feature.

## Stage 1 — <short name>
**Mode:** Plan mode
**Goal:** ...
**References:** `src/lib/<module>.md`, `src/components/<Component>.md`
**Touches:** `src/...`, `src/...`
**Done when:** ...
**Landed:** _(commit sha, filled in by the executing session)_

## Stage 2 — <short name>
**Mode:** Accept edits
**Goal:** ...
**References:** ...
**Touches:** ...
**Done when:** ...
**Landed:**

## Stage 3 — <short name>
**Design pass:** the whole settings UI — needs its own planning session before execution starts.
**Goal:** ...
_(`Mode`, `References`, `Touches`, `Done when` are filled in by that session, which may also split this stage.)_

## Notes
_(appended by executing sessions — non-obvious findings only)_
```
