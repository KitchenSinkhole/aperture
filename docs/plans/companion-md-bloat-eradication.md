# Eradicate Companion `.md` Bloat

**Goal:** Remove all surviving change-rationale / history / implementation-string / cross-reference bloat from every companion `.md` in `src/**`, and leave behind an advisory tool to find it again.

**References:**
- `CLAUDE.md` → section **"The companion indexes current state — it is not a changelog"** (committed in `f80f0486`) — the rubric this sweep enforces: the gate, the never-include list (change-rationale, history/temporal phrasing, implementation strings, rationale cross-refs), the day-one test, the **invariant ≠ change-rationale** carve-out, and the **schema-migration provenance** exception.
- Existing script pattern: `scripts/*.ts` run via `tsx`, each with a companion `.md`, wired in `package.json` (e.g. `jobs:status` → `tsx scripts/jobs-status.ts`).

---

## Context

Over the project's history there have been **915 modify events** across **241 distinct** companion `.md` files (377 companions exist today). Many edits documented *the change itself* — why a line differs from before, what bug prompted it, the exact Tailwind classes — instead of just the module's current interface and behaviour. This bloats the index and defeats its purpose (a cheap, scannable map of the codebase).

`CLAUDE.md` now defines what belongs in a companion (commit `f80f0486`), which **prevents future** bloat. This plan **fixes the past**: a one-time, complete sweep of the current tree against that rubric, plus an advisory scanner to re-check on demand.

**Decisions made with the user:**
- **Depth:** full churn-prioritized sweep of *all* companions (not just regex hits).
- **Tooling:** advisory scan script only — **no** CI gate.
- **Execution:** batches delegated to the `companion-md-writer` subagent; **every proposed diff is reviewed in the main session before it lands.**

**Core principle:** the audit unit is **current file content vs. the rubric**, *not* historical diffs. Bloat that was later rewritten away is irrelevant; only what survives into today's files matters. An edit removes **only** rationale/history/impl-strings/cross-refs — it must never drop a current prop, behaviour, or **invariant** (e.g. a security guarantee, an ordering/mass constraint). When unsure, the CLAUDE.md invariant-vs-change-rationale test decides.

---

## Stage 1 — Advisory smell-scan script
**Mode:** Accept edits
**Goal:** A read-only reporter that lists companions carrying likely bloat, categorized and prioritized, to drive (and later re-verify) the sweep.
**Touches:** `scripts/companion-smell-scan.ts`, `scripts/companion-smell-scan.md`, `package.json` (add `"companions:scan": "tsx scripts/companion-smell-scan.ts"`).

**Behaviour:**
- Scans `src/**/*.md`. For each, flags lines matching smell categories:
  - **History/temporal:** `no longer`, `previously`, `formerly`, `moved from/to`, `replaced the`, `instead of the old`, `deprecated`, `used to`.
  - **Rationale:** `Why it exists`, `breached`, `rolled … back`, `workaround`, `in order to`, `the reason`, `this prevents`, `regression`, `to avoid the`.
  - **Implementation strings:** `color-mix(`, `bg-[`, `[&_`, `className=`, long raw Tailwind runs.
  - **Cross-ref rationale:** `` matches ` ``.
- Annotates each file with its **git modify-count** (`git log --no-merges --diff-filter=M`) so output is sorted hot-first.
- **Advisory, not authoritative:** prints a header noting high false-positive rate (e.g. "row no longer exists" = *doesn't exist*; "previously-present systems" = a real state transition). Output is a candidate list a human triages, never an auto-fixer.

**Done when:** `pnpm companions:scan` prints a churn-sorted, categorized candidate report; its own companion `.md` obeys the rubric (no impl strings describing its own regexes).

## Stage 2 — Full churn-prioritized sweep
**Mode:** Accept edits (subagent proposes; main session reviews + commits every diff)
**Goal:** Every companion in `src/**` reads as a pure current-state index — zero surviving rationale/history/impl-strings/cross-refs, zero lost interface/behaviour/invariant facts.
**Touches:** companion `.md` files across `src/**` only. **No `.ts`/`.tsx` changes** — this is docs-only.

**Tiers (priority order, by modify-count):**
- **Tier A — hot files (~53, modified ≥5×):** where copy-paste creep concentrates. Known offenders to seed it: `src/app/api/map/[mapId]/systems/[systemId]/signatures/route.md` ("Why it exists" + 8 KB bug story), `src/lib/map/client.md` & `src/lib/map/applyEvent.md` (same bug story echoed), `src/lib/auth/rights.md` ("corp-right matrix no longer participates" ×2), `src/app/(app)/map/[[...slug]]/page.md` ("was replaced by … no longer computes"), `src/components/sidebar/SignatureModule.md` (raw class strings in Row-density), `src/components/map/MapCanvas.md`, `src/lib/realtime/protocol.md`, `src/components/map/SystemNode.md`.
- **Tier B — long tail (~146, modified 1–4×):** fast skim; less likely but not exempt.
- **Tier C — never-modified (136):** still audited — creation-time bloat exists here (`route.md` above was bloat-on-creation).

**Batch procedure (repeat per batch — group by directory, ~10–20 files):**
1. Run `companions:scan` (or reuse Stage 1 output) to pre-mark the batch's candidates.
2. Dispatch the batch to a `companion-md-writer` subagent with: the CLAUDE.md rubric section verbatim, the file list, and the instruction — *trim only change-rationale / history-temporal phrasing / implementation strings / rationale cross-refs; preserve every current prop, behaviour, and invariant; do not "fix" correct present-tense phrasing that merely contains a trigger word (e.g. "the row no longer exists" = does not exist); for `src/db/schema/**` keep bare `(migration NNNN)` provenance but drop its rationale tail.*
3. **Review every proposed diff in the main session against the rubric** — confirm each removed clause is genuinely rationale/history/impl/cross-ref and that no current fact was lost. Reject/adjust over- or under-trims.
4. Commit the reviewed batch (docs-only) with a clear message; one commit per batch keeps review tractable.

**Recommended:** do the sweep on a dedicated branch (e.g. `companion-md-cleanup`) → PR into `dev` (per project convention PRs target `dev`), rather than committing the whole sweep straight onto `dev`.

**Done when:** all three tiers processed; a final `companions:scan` shows only triaged, genuine false positives remaining; every commit is docs-only.

---

## Verification

- **Scanner delta:** `pnpm companions:scan` before vs after — every flagged line is either removed or recorded on a short triage allowlist of confirmed false positives (kept in the script's `.md` or a comment).
- **No information loss (spot check):** for ~5 cleaned companions across different dirs, diff the trimmed `.md` against its source `.ts/.tsx` and confirm every current prop / export / behaviour / invariant is still described. The only deletions are rationale/history/impl/cross-ref.
- **Docs-only:** `git diff --name-only <base>` lists *only* `.md` files (plus the Stage 1 script + `package.json`). No source behaviour changed.
- **Build sanity:** `pnpm lint` / `pnpm typecheck` still green (expected — docs-only, but confirms the Stage 1 script + `package.json` edit are clean).
- **Guard works:** plant a fake bloat line ("Why it exists: …") in one companion → `companions:scan` flags it → remove it.

## Caveats / judgment calls

- **False positives are the main risk.** The scanner is high-recall, low-precision by design. The reviewer (main session) is the precision filter — never let the subagent strip correct present-tense state just because it matches a pattern.
- **Invariants stay.** Security guarantees ("a foreign system 404s so a viewer can't harvest another map's sigs"), ordering/mass constraints, and "declared in SQL only" structural facts are current behaviour — keep them; only their *change-story* tail goes.
- **Subagent over/under-trim.** Mitigated by per-diff review; if a batch's diffs are noisy, fall back to doing that batch inline.
