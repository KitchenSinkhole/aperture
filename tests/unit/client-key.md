## client-key.test.ts

**Purpose:** DB-free unit tests for caller-address resolution (`src/lib/http/clientKey.ts`).
**File:** `tests/unit/client-key.test.ts`

### Covers
- `resolveClientIp` — zero hops uses the socket peer and ignores every header; one and two hops take the entry the trusted proxies appended, ignoring entries the client wrote and tolerating stray whitespace and empty entries; too few entries take the right-most entry and ignore `X-Real-IP`; with no entries at all it falls back to `X-Real-IP`, the socket peer, then `'unknown'`.
- `clientIpOfNodeRequest` — repeated `X-Forwarded-For` headers are joined in order; the socket's `remoteAddress` is the peer.
- `clientIpOfRequest` — reads `CLIENT_IP_HEADER`, never `X-Forwarded-For`, and answers `'unknown'` without it.
