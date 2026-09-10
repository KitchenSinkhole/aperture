# Abyssal Connections Should Not Be Permanent

**Date:** 2026-08-13
**Status:** known defect, unfixed. Introduced by `trackAbyssalJumps` (map-settings-audit Stage 4, commit `067d3d29`).
**Scope:** `src/lib/jobs/tasks/expiredConnections.ts`, `src/lib/map/connectionState.ts`, `src/lib/map/mutations/systems.ts`.

**In one line:** every lifecycle path in the codebase splits on `scope = 'wh'` versus everything else, and "everything else" was written when the only other scopes were structural. An abyssal edge is not structural, so it inherits permanence it has no basis for.

---

## The mistaken assumption

`connection_scope` has carried an `'abyssal'` value since migration 0004, but nothing ever wrote one until Stage 4. Every non-`wh` code path was therefore authored against `stargate` and `jumpbridge` only, and both of those are **structural**: they are derivable from static universe data, they are true whether or not anyone observed them, and they are still true tomorrow. Permanence is the correct treatment for a structural edge.

An abyssal edge is **observational**. It exists only because a tracked character happened to take a filament, it describes a passage that lasted minutes, and nothing in the SDE can re-derive it once it is gone. Filaments collapse behind you. There is no persistent link between an entry system and an abyssal pocket, and the same pocket reached twice is not the same place.

Stage 4 correctly kept abyssal out of the mass log and the auto-tagger, both of which are wormhole-specific. What it did not do is give abyssal a lifecycle, so it silently fell through to the structural branch of three separate guards.

## The three paths that assume structural

1. **`expiredConnections.ts:36`** filters the reaper to `scope = 'wh'`. Its own docblock (`:20`) states that "Non-WH scopes (`stargate`, `jumpbridge`, `abyssal`) are stable and never expire", which names abyssal explicitly as stable. Nothing reaps an abyssal edge, ever.

2. **`connectionState.ts:40`** returns `null` for any non-`wh` scope, so an abyssal edge has no expiry state and no EOL stage. It cannot age, so it cannot be shown as aging.

3. **`mutations/systems.ts:184`** dormants only `scope = 'wh'` on `removeSystem`, setting `confirmed_at = NULL` so the edge drops out of `loadMapForView`. The comment above it (`:176`) explains that non-`wh` links "stay confirmed and re-link structurally via `addSystemWithStargateLinks` on re-add". That reasoning holds for stargates and fails for abyssal: the re-link helper only creates stargate edges, so an abyssal edge is never re-derived, only preserved.

## What actually happens

Removing an abyssal node does not clear its edges. They keep `confirmed_at NOT NULL` and simply stop rendering while the node is invisible. `addSystem` reuses the `(map_id, system_id)` unique row and flips `visible` back to `true`, so re-adding that system id, for any reason and by any user, makes every stale abyssal edge reappear at once.

Meanwhile each run into a distinct abyssal system from a distinct entry system hangs one more permanent edge. Nothing removes them, so on a map with the toggle left on (it defaults to on) the count only grows.

## What correct behaviour looks like

An abyssal edge should record a traversal that has already ended. It should not outlive the session that produced it, and it must never resurrect. It is closer to a wormhole than to a stargate, but it is not a wormhole either: it has no mass budget, no EOL state machine, and no signature to re-paste, so reusing the `wh` lifecycle wholesale would give it three concepts it cannot support.

Three directions worth weighing, in rough order of how much they question the premise:

- **Give abyssal its own short lifetime in the reaper.** Smallest change. Needs a constant and a second branch in `expiredConnections.ts`, and leaves the resurrection bug in `removeSystem` untouched unless that is fixed too.
- **Hard-delete abyssal edges on system removal** rather than dormanting or preserving them, matching the CLAUDE.md rule that collapsed links do not come back. Fixes resurrection but not accumulation.
- **Do not persist the edge at all.** Record the traversal as an `ap_map_event` and let the canvas render it transiently, the way `connectionMassLog` and `systemNotification` already work for server-observed facts. This asks whether a filament run is map state or an observation, and the honest answer may be the latter, which would also remove the need for any reaping at all.

The third option is the one to decide first, because the other two are only worth designing if a persisted abyssal edge is the right model to begin with.

## Related

- `docs/plans/map-settings-audit-fixes.md`, Stage 4 and its `## Notes`, where this consequence was accepted knowingly as the cost of a first cut.
- `src/lib/map/locationToConnection.md` for the fold path that creates these edges.
