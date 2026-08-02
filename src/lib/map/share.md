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

A share token resolves to exactly one map id; callers (the Stage 3 public route, the Stage 5 WS upgrade handler) pin to that id rather than trusting any client-supplied map selector.
