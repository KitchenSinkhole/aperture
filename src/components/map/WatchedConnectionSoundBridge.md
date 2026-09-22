## WatchedConnectionSoundBridge

**Purpose:** Plays the `watchedJump` cue when a tracked pilot jumps a wormhole this device watches.
**File:** `src/components/map/WatchedConnectionSoundBridge.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| mapId | string | yes | The open map; keys the watch store. |
| systems | MapSystemNode[] | yes | Current visible systems; maps EVE solar-system id → `ap_map_system.id`. |
| connections | MapConnectionEdge[] | yes | Current connections; matched against the jump's endpoints in either direction. |
| viewerCharacterIds | number[] | yes | The viewer's own characters; their jumps never earn a cue. |

### Renders
Nothing.

### Behaviour & Interactions
- Mounted by `MapCanvas` only when the account has `watchedJump` enabled, so an off setting means the code path is absent rather than gated at runtime.
- Each traversal resolves through `resolveTraversalEdges`; the cue fires when any resolved connection is watched, once per jump however many parallel holes match.
- The variant comes from `watchedJumpVariant` against the system the viewer's active character occupies, read live from the presence store at event time. A traversal fires synchronously from inside `PresenceStore.apply()`, so a same-frame burst is classified before React re-renders and a render-scoped copy of the viewer's system would be a commit behind. The active character id, which a jump never changes, comes from the active-char context.
- A viewer with no located character still hears the cue, in its `plain` variant.
- `systems` / `connections` are read through refs so the traversal subscription never churns.

### Depends On
- `./MapPresenceContext` — `useTraversals`, `usePresenceStore`.
- `./MapActiveCharContext` — `activeCharId`.
- `./MapTravelContext` — `resolveTraversalEdges`.
- `@/lib/connectionWatchPrefs` — `isConnectionWatched`.
- `@/lib/sounds/engine` — `getSoundEngine().play`.
- `@/lib/sounds/presenceEvents` — `watchedJumpVariant`.
