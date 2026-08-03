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

### listMapShares(mapId: bigint): Promise<MapShareListItem[]>
Every non-revoked share on a map, newest first — the rows the Share links panel renders. Expired shares are kept and flagged `expired` (resolved server-side against `now()`, so the row's status doesn't depend on the client's clock) so a manager can see why a link stopped working; a revoked share leaves the panel and survives only in the audit log. LEFT JOINs `ap_character` for the creator's name.

**Returns:** Rows including the **raw token**, so a caller must gate on `share_manage` before calling.

---

### loadLiveShareBadges(mapId: bigint): Promise<LiveShareBadge[]>
The map's live shares without their tokens — the feed for the in-map "this map is published" indicator, which every viewer sees, not just managers. Same liveness rule as `resolveShareToken` minus the soft-deleted-parent clause, which the map page has already established by rendering at all.

---

### revokeShareToken(shareId: bigint): Promise<string | null>
Sets `revoked_at` on the share and closes every live public WebSocket pinned to its token (`closePublicSocketsForToken`). Idempotent: a share that is already revoked or does not exist is left alone and the function returns `null`.

**Parameters:**
- `shareId` — `ap_map_share.id`.

**Returns:** The revoked share's token (for the caller's audit entry), or `null` if there was nothing live to revoke.

Does not invalidate the snapshot cache — `publicSnapshot.ts` is `server-only` and unreachable from this module — but the cache's short TTL means the page 404s within one window regardless.
