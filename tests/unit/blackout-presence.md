## blackout-presence.test.tsx

**Purpose:** Proves the client side of Blackout: `useBlackoutStatus` tracks the viewer's standing from the page seed and live `healthCheck`s, and `MapPresenceProvider` prunes presence to the viewer's account while Blackout restricts them.
**File:** `tests/unit/blackout-presence.test.tsx`

### Setup
- `PresenceStore` is exercised directly for the prune itself.
- The provider cases stub `globalThis.SharedWorker` with a fake whose port the test drives (`port.onmessage({ data: { type: 'message', envelope } })`), render with `react-dom/client` + `act`, and mount a `Harness` that wires `useBlackoutStatus(initial)` into `MapPresenceProvider` the way `MapCanvas` does. A `Probe` records `usePresenceForMap()`'s character ids; the roster holds two of the viewer's characters and one from another account.

### Cases
- **pruneToAccount** keeps only the given account's entries across every system slice.
- The standing comes from `initial` until a `healthCheck` carries `blackout`; a `healthCheck` without it keeps the current value.
- A change from off to on-and-not-cleared prunes to the viewer's account; an initial state that already restricts prunes on mount.
- A cleared viewer is never pruned and keeps folding other accounts' `characterUpdate`s.
- After a change back to off, a later `characterUpdate` for another account repopulates the store.

### Depends On
- `@/components/map/MapPresenceContext`, `@/lib/realtime/useRealtime` (`RealtimeProvider`, `useBlackoutStatus`), `@/types` (`BlackoutStatus`).
