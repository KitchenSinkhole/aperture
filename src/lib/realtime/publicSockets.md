## publicSockets.ts

**Purpose:** Admission (upgrade rate limiting, per-token connection cap) and the live-socket registry for token-authed public spectator WebSockets.
**File:** `src/lib/realtime/publicSockets.ts`

---

### allowPublicUpgrade(clientKey: string, now?: number): boolean
Fixed-window rate limiter on the public WS upgrade handshake, mirroring `allowPublicSnapshotRequest` (`src/lib/map/publicSnapshot.ts`): per-IP and global counters (`PUBLIC_WS_MAX_UPGRADES_PER_IP` / `PUBLIC_WS_MAX_UPGRADES_GLOBAL`) over a `PUBLIC_WS_UPGRADE_WINDOW_MS` window, with the per-IP map cleared whenever the global window rolls.

**Parameters:**
- `clientKey` — best-effort caller IP (`clientKeyFromForwardedFor`).
- `now` — injectable clock for tests.

**Returns:** `false` once either cap is exceeded for the window (the caller answers with a rejected upgrade).

---

### registerPublicSocket(token: string, close: (code: number) => void): () => void
Registers a live public socket against its share token. Returns a deregister function the socket's own close handler calls.

**Parameters:**
- `token` — the share token the socket is pinned to.
- `close` — closes the socket with the given code; used by `closePublicSocketsForToken`.

**Returns:** A deregister function.

---

### publicSocketCount(token: string): number
Live public socket count for one share token — what `wsServer.ts` checks against `PUBLIC_WS_MAX_PER_TOKEN` at upgrade.

---

### publicSocketTotal(): number
Live public socket count across every share token.

---

### closePublicSocketsForToken(token: string): number
Closes every live public socket pinned to `token` with code `4001`, e.g. from `revokeShareToken` (`src/lib/map/share.ts`). Snapshots the registered closers before iterating, since each `close()` call runs the deregister function that mutates the same set.

**Returns:** The number of sockets closed.

---

### __resetPublicSockets(): void
Test seam: clears the registry and rate-limit state between cases.
