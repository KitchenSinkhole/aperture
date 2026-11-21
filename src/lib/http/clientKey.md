## clientKey.ts

**Purpose:** Resolves the caller's address for the in-process rate limiters (user API, public snapshot, public WebSocket upgrade), trusting `X-Forwarded-For` only as far as the operator's `TRUSTED_PROXY_HOPS`.
**File:** `src/lib/http/clientKey.ts`

`server.ts` resolves every HTTP request once and writes the result to `CLIENT_IP_HEADER`, overwriting any value the client sent; route handlers read that header. The WebSocket upgrade handler resolves its own requests with `clientIpOfNodeRequest`. No address is persisted.

---

### CLIENT_IP_HEADER
`'x-aperture-client-ip'`, the request header carrying the resolved address to route handlers.

---

### resolveClientIp(parts: { forwardedFor, realIp, socketAddress }, trustedHops: number): string
Pure. With `trustedHops` 0, the socket peer. Otherwise the `X-Forwarded-For` entry `trustedHops` places from the right, since each trusted proxy appends the address it received the request from and everything further left was written by the client. A request with fewer entries than `trustedHops` takes its right-most entry, the one the nearest proxy appended. `X-Real-IP` is read only when `X-Forwarded-For` is absent or empty, since a client can write it whenever a proxy appends rather than sets; then the socket peer. `'unknown'` when nothing is available.

---

### clientIpOfNodeRequest(req: IncomingMessage, trustedHops?: number): string
`resolveClientIp` over a raw Node request (repeated `X-Forwarded-For` headers joined in order, the socket's `remoteAddress`), with `trustedHops` defaulting to `env.TRUSTED_PROXY_HOPS`. Used by `server.ts` and the public WS upgrade handler.

---

### clientIpOfRequest(headers: Headers): string
The `CLIENT_IP_HEADER` value of a route-handler request, or `'unknown'` when absent (a handler called directly, as in tests).

---

### Depends On
- `@/lib/env` (`TRUSTED_PROXY_HOPS`).
