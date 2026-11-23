## experimentalRoutePrefs.ts

**Purpose:** Device-local experimental route planner toggles (exit origin, jump-bridge overlay).
**File:** `src/lib/experimentalRoutePrefs.ts`

### readExperimentalExitOrigin() / writeExperimentalExitOrigin(v)
Persist `chain` vs `selected` as the origin when comparing exit routes and resolving shortcuts. Inactive when experimental UI is off.

### readExperimentalIncludeJumpBridge() / writeExperimentalIncludeJumpBridge(on)
Whether mapped jump-bridge edges participate in route compute; default on. Merged into the `prefs` sent to `route-plan` only (not stored on `ap_user`).

### subscribeExperimentalRoutePrefs(onChange)
Listens for `aperture:experimental-route-prefs` on `window` after writes.

### readExperimentalFightMapSystemId / writeExperimentalFightMapSystemId
Device-local fight anchor (`ap_map_system.id`) for home→fight route shortcuts.

### fightTaggedSystems(systems)
Systems whose `tag` or `alias` matches `/fight/i`.

### resolveHomeFightRouteEnds(systems, homeMapSystemId)
Returns `{ home, fight }` map nodes — fight prefers the persisted id, else the first fight-tagged system.
