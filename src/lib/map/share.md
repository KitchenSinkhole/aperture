## share.ts

**Purpose:** Public map-share token generation and resolution — the model layer behind `/live/<token>`.
**File:** `src/lib/map/share.ts`

---

### generateShareToken(): string
A fresh, URL-safe share token (`randomBytes(16).toString('base64url')`, 128 bits of entropy in 22 chars). Not persisted by this function — the caller inserts the `ap_map_share` row.

---

### resolveShareToken(token: string): Promise<ResolvedShareToken | null>
Resolves a raw share token to its map id and redaction profile via one indexed join against `ap_map`. Returns `null` when the token is unknown, expired, revoked, or its parent map is soft-deleted — every failure path is indistinguishable to the caller (no status-code or timing leak), and the matched token is re-confirmed with `timingSafeEqual`.

**Parameters:**
- `token` — the raw token from the `/live/<token>` URL.

**Returns:** `ResolvedShareToken` (`{ shareId, mapId, label, profile: ShareRedactionProfile }`), or `null`.

A share token resolves to exactly one map id; callers (the public route, the WS upgrade handler) pin to that id rather than trusting any client-supplied map selector.

---

### revokeShareToken(shareId: bigint): Promise<string | null>
Sets `revoked_at` on the share and closes every live public WebSocket pinned to its token (`closePublicSocketsForToken`). Idempotent: a share that is already revoked or does not exist is left alone and the function returns `null`.

**Parameters:**
- `shareId` — `ap_map_share.id`.

**Returns:** The revoked share's token (for the caller's audit entry), or `null` if there was nothing live to revoke.

Does not invalidate the snapshot cache — `publicSnapshot.ts` is `server-only` and unreachable from this module — but the cache's short TTL means the page 404s within one window regardless.
