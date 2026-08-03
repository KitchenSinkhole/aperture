## usePublicSnapshot.ts

**Purpose:** Client hook that keeps a spectator's redacted snapshot current via a token-pinned public WebSocket, refetching the cached snapshot on nudge and degrading to polling when the socket is unavailable.
**File:** `src/components/public/usePublicSnapshot.ts`

---

### usePublicSnapshot(token: string, initial: PublicMapViewData): { data: PublicMapViewData; status: PublicFeedStatus; updatedAt: number }
Opens a `WebSocket` to `apertureConfig.WS_PUBLIC_PATH` with the token as a query param. On a `publicUpdate` nudge, schedules exactly one refetch of `GET /api/public/[token]/snapshot` at `PUBLIC_SNAPSHOT_CACHE_TTL_MS` plus random jitter up to `PUBLIC_REFETCH_JITTER_MS` — that delay is load-bearing: any cache entry still live when the refetch lands was created after the nudge, so a shorter delay could return a pre-edit snapshot. Concurrent nudges within one pending refetch's window collapse onto it.

On socket close/error, falls back to polling the snapshot at `PUBLIC_POLL_INTERVAL_MS` while retrying the socket with the same capped-exponential backoff as the session transport (`WS_RECONNECT_BASE_MS`/`WS_RECONNECT_MAX_MS`). A `PUBLIC_IDLE_REFRESH_MS` backstop refetches even with no nudge, so a quiet map's `expires_at` still gets noticed. Polling and the idle backstop are skipped while the tab is hidden, and a becoming-visible tab refetches immediately.

A `404` from any refetch is treated as authoritative — it flips `status` to `'ended'` and stops the socket and every timer for good. A socket close with code `4001` (server-side revoke or map deletion) only triggers one confirming refetch rather than ending the view on its own.

**Parameters:**
- `token` — the share token from the `/live/<token>` URL.
- `initial` — the server-rendered snapshot to seed state with.

**Returns:**
- `data` — the latest `PublicMapViewData`.
- `status` — `'live'` (socket open), `'polling'` (degraded), or `'ended'` (token no longer resolves).
- `updatedAt` — `Date.now()` at the last successful refetch.

### Depends On
- `@/lib/realtime/protocol` (`serverToClientMessageSchema`) — validates inbound frames before checking for `task === 'publicUpdate'`.
- `aperture.config` (`WS_PUBLIC_PATH`, `PUBLIC_SNAPSHOT_CACHE_TTL_MS`, `PUBLIC_REFETCH_JITTER_MS`, `PUBLIC_POLL_INTERVAL_MS`, `PUBLIC_IDLE_REFRESH_MS`, `WS_RECONNECT_BASE_MS`, `WS_RECONNECT_MAX_MS`).
