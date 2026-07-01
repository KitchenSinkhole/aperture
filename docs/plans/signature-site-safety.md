# Signature Site Safety — combat vs exploration

**Goal:** Classify each cosmic signature as a `combat` or `exploration` site and surface it in the signature panels (a per-row glyph + a search filter), with a per-signature right-click override so users can re-mark a site (e.g. a gas site cleared of rats).
**Issue:** #129.
**References:** `src/lib/map/signatureSites.md`, `src/components/sidebar/SignatureModule.md`, `src/components/sidebar/SignatureSearchModule.md`, `src/lib/map/sigSearch.md`, `src/db/schema/ap/enums.md`, `src/db/schema/ap/map_signature.md`, `src/lib/realtime/protocol.ts`, `src/lib/map/mutations/signatures.md`. CLAUDE.md rules: hand-written migrations (memory: *migrations hand-written since 0011*), companion `.md` upkeep, three mutation pathways, `pgEnum` for small lookups.

## Model

Two layers:

1. **Derived default** (no DB): a pure `siteActivity(name, groupKey)` classifier seeded from the whtype.info "safe-explo" dataset. Returns `'combat' | 'exploration' | null` (null = not enough info / not applicable). A signature with no resolved site `name` yet is `null` — you can't know a site's activity before it's identified.
2. **Persisted override** (one migration): nullable `ap_map_signature.activity_override` (enum `signature_activity`). When set it wins over the derived value. This is what the right-click menu writes.

**Effective value** = `activityOverride ?? siteActivity(name, groupKey)`, read by both the glyph and the search filter.

### Naming caveat (do not regress)

`combat` is also a `signature_group_key` value. The activity axis is **orthogonal** to the scanner group (a `relic` site can be a `combat` *activity*). Keep the type named `SignatureActivity` and the column `activity_override` so it never reads as a group. Do **not** collapse the two.

## Data source — whtype.info/safe-explo (vendored, not fetched at runtime)

The whtype dataset lives at `https://whtype.info/js/sites.js` as a static `SITE_ENTRIES[]` array with a `safe: ['SAFE'] | ['NOT SAFE']` field. We **vendor** the classification (bake it into `siteActivity.ts`), we do not fetch it at runtime — a cross-origin dependency on an unversioned file is against the no-external-runtime-dep grain. Update model is the same as `signatureSites.ts`: edit the module and redeploy. Credit it with a `// Source: whtype.info/safe-explo (<date>)` comment.

**`SAFE` → `exploration`, `NOT SAFE` → `combat`.** Snapshot of the mapping (whtype `wormhole` slug → our `signatureSites.ts` full-name prefix → activity):

| whtype slug | matches site name | activity |
|---|---|---|
| `forgotten` | `Forgotten *` (relic) | combat |
| `ruined` | `Ruined *` (NULL_RELIC) | exploration |
| `unsecured` | `Unsecured *` (data) | combat |
| `central` | `Central *` (NULL_DATA) | exploration |
| `abandoned-research` | `Abandoned Research Complex *` (NULL_DATA) | combat |
| `*-covert` | `* Covert Research Facility` (ghost) | combat |
| all gas rows | `* Reservoir` (gas) | combat |

> **Correction baked into the table above:** the Sleeper-native sites (`Forgotten*` relic, `Unsecured*` data) are the *dangerous* ones; the null-sec sites bleeding into low-class holes (`Ruined*`, `Central*`) are unguarded. An earlier hand-derivation had this inverted — trust the table, which follows whtype's `safe` field.

Note whtype **splits** `abandoned-research` (combat) from `central` (exploration) even though both sit in our `NULL_DATA` set — so classify by **site-name prefix**, never by our group bucket.

Not in whtype (we default): pure combat anomalies (`groupKey === 'combat'`) → `combat`; ore (`* Deposit`, `Shattered * Field`) → `exploration` (no rats); wormhole group → `null`.

### `siteActivity(name, groupKey)` logic

```
if groupKey === 'wormhole'  → null
if groupKey === 'combat'    → 'combat'
if groupKey === 'ore'       → 'exploration'
if groupKey === 'ghost'     → 'combat'
if groupKey === 'gas'       → 'combat'          // whtype marks all gas NOT SAFE
if groupKey === 'relic' | 'data':
    name starts "Forgotten " | "Unsecured " | "Abandoned Research" → 'combat'
    name starts "Ruined " | "Central "                            → 'exploration'
    else → null                                  // unidentified / unknown site
else → null
```

Keying on `(name, groupKey)` (not name alone) resolves the `Ordinary Perimeter Reservoir` (gas → combat) vs `Ordinary Perimeter Deposit` (ore → exploration) prefix collision cleanly and lets combat anomalies classify without enumerating every combat name.

---

## Stage 1 — Derived classifier + tests

**Mode:** Accept edits
**Goal:** A pure, isomorphic `siteActivity(name, groupKey)` + `effectiveSignatureActivity(sig)` with unit tests. No schema, no UI.
**Touches:**
- Create `src/lib/map/siteActivity.ts` — `SignatureActivity` = `'combat' | 'exploration'`; `siteActivity(name, groupKey): SignatureActivity | null` (whtype-seeded, table above); `effectiveSignatureActivity(sig): SignatureActivity | null` returning `sig.activityOverride ?? siteActivity(sig.name, sig.groupKey)`.
- Create `src/lib/map/siteActivity.md` companion.
- `src/types/index.ts` — export `SignatureActivity` (add to the shared-types file, not inline).
- Create `tests/unit/site-activity.test.ts` — cover each branch: Forgotten/Unsecured/Abandoned Research → combat; Ruined/Central → exploration; every gas Reservoir → combat; ghost → combat; ore Deposit → exploration; wormhole → null; unidentified relic/data (null/blank name) → null; the Reservoir-vs-Deposit collision; override precedence via `effectiveSignatureActivity`.

**Done when:** `pnpm test tests/unit/site-activity.test.ts` passes; `siteActivity.md` accurate. (`effectiveSignatureActivity` reads `sig.activityOverride`, added in Stage 2 — until then reference it as optional/`?? undefined`; Stage 2 makes it a real field. Order Stage 1's type to tolerate `activityOverride` being absent, or land Stage 2 first — either works, they only meet at `effectiveSignatureActivity`.)

## Stage 2 — Persist the override (migration + threading)

**Mode:** Accept edits
**Goal:** Add `signature_activity` enum + nullable `ap_map_signature.activity_override`, and thread it through every layer `classKind` already flows through. This is a near-mechanical mirror of migration 0045/0047.
**Touches:**
- **Migration** `src/db/migrations/0048_signature_activity_override.sql` + `.rollback.sql` + a `_journal.json` entry (idx 48). Hand-written (do **not** run `db:generate`). Body mirrors `0047_signature_class_kind.sql`:
  - `CREATE TYPE "public"."signature_activity" AS ENUM('combat', 'exploration');`
  - `ALTER TABLE "ap_map_signature" ADD COLUMN "activity_override" "signature_activity";`
  - Rollback drops the column then the type.
  - Apply it against the dev DB before running tests (memory: *migrations hand-written since 0011*).
- `src/db/schema/ap/enums.ts` + `.md` — add `signatureActivity` pgEnum (mirror the `signatureClassKind` entry; note it is the override axis, orthogonal to `signature_group_key`, `(migration 0048)`).
- `src/db/schema/ap/map_signature.ts` + `.md` — add `activity_override` column (nullable; camelCase `activityOverride`).
- `src/types/index.ts` — `MapSignature` picks up `activityOverride` via the inferred schema type; confirm it surfaces.
- `src/lib/realtime/protocol.ts` — add `activityOverride: signatureActivityEnum.nullable()` to `signatureBody`, and `.nullable().optional()` to the `signature.update` shape (mirror `classKind` at both sites).
- `src/lib/map/mutations/signatures.ts` + `.md` — accept `activityOverride` in `CreateSignatureInput`/`UpdateSignaturePatch` and include it in the emitted body/snapshot (mirror `classKind`).
- API zod bodies: `src/app/api/map/[mapId]/signatures/route.ts` (create), `.../[sigId]/route.ts` (PATCH), `.../bulk/route.ts` — accept optional `activityOverride: 'combat' | 'exploration' | null`. Update each `route.md`.
- `src/lib/map/client.ts` — add `activityOverride?: SignatureActivity | null` to `CreateSignatureBody` and `UpdateSignatureBody`.

**Done when:** migration applied; `pnpm typecheck` green; an existing signature can be PATCHed with `activityOverride` and the change round-trips through realtime (mirrors the `classKind` path). No backfill — legacy rows stay `null` (derived value covers them).

## Stage 3 — Row glyph + right-click override in `SignatureModule`

**Mode:** Accept edits
**Goal:** Show the effective activity as a glyph in each signature row and let the user re-mark it via right-click. `SignatureModule` is the editing surface, so the override lives here.
**Touches:**
- `src/components/sidebar/SignatureModule.tsx` + `.md`:
  - New leftmost/aux glyph driven by `effectiveSignatureActivity(sig)`: `combat` → red sword (lucide `Swords`), `exploration` → green check (lucide `ShieldCheck`), `null` → nothing. Each carries a `<title>` ("Combat site" / "Exploration site"). Follow the existing headerless class-kind icon column precedent (`ClassKindCell`). Render it as its own module-level cell component wired through `table.options.meta` (keep the stable-cell-identity rule — see the SignatureModule companion; do not introduce per-render cell closures).
  - Right-click context menu on the row (Base UI `ContextMenu.Root`, same pattern as `MapContextMenu`): items **Mark as combat**, **Mark as exploration**, **Auto** (clears the override → back to derived). Each issues `onPatch(sig.id, { activityOverride })` (`null` for Auto). Reflect the current override state (radio/checkmark on the active choice) so it's clear when a row is overridden vs auto.
  - When an override differs from the derived value, hint it subtly (e.g. a dot on the glyph or a "(manual)" title suffix) so an overridden row is distinguishable from an auto one.

**Done when:** glyphs render from the effective value; right-click writes/clears `activityOverride` through the existing signature PATCH pathway (optimistic + realtime, like every other in-row edit); companion updated; `pnpm lint && pnpm typecheck && pnpm build` green.

## Stage 4 — Activity filter in `SignatureSearchModule`

**Mode:** Accept edits
**Goal:** Let the search panel filter by activity (the issue's literal ask) and show the same glyph in results.
**Touches:**
- `src/types/index.ts` — extend `SigSearchFilters` with `activity: SignatureActivity | null` (null = any).
- `src/lib/map/sigSearch.ts` + `.md` — `buildSigSearchResults` filters on `effectiveSignatureActivity(sig)` when `filters.activity` is set. Add a unit case to `tests/unit/` (the existing sigSearch tests file) for the new filter.
- `src/components/sidebar/SignatureSearchModule.tsx` + `.md` — a tri-state control (Any / Combat / Exploration) in the filter bar, wired to `onFiltersChange`; render the activity glyph in the results table (read-only; overrides are edited in `SignatureModule`).
- `src/components/map/MapCanvas.tsx` — the `SigSearchFilters` initial state (owned here) gains `activity: null`.

**Done when:** search filters by combat/exploration over the effective value; glyph shows in results; `pnpm lint && pnpm typecheck && pnpm build` green; sigSearch tests pass.

---

## Notes / decisions already settled

- **Override is in scope from the start** (not a later phase): the "mark a cleared gas site" case is expected, and whtype marks *all* gas `NOT SAFE`, so without the override every gas site reads combat forever.
- **No runtime fetch of whtype** — vendor the mapping as a static seed.
- **Unidentified sigs get no glyph** (`null`) — inherent; the override is the escape hatch when a user knows better than the (absent) name.
- **Ore defaults to `exploration`, wormhole to `null`** — neither is in whtype.
- When kulnor's fuller site catalogue lands, re-run the seed expansion and diff `siteActivity.ts`; no schema churn (it only ever adds/moves derived defaults; the enum already covers both states).
