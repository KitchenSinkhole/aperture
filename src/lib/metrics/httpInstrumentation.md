## httpInstrumentation.ts

**Purpose:** Per-route HTTP golden-signals wrapper — times an App-Router handler and emits `http_requests_total` + `http_request_duration_ms` under a bounded route template.
**File:** `src/lib/metrics/httpInstrumentation.ts`

---

### withApiMetrics<Ctx>(template: string, handler: (request: NextRequest, ctx: Ctx) => Promise<Response>): (request: NextRequest, ctx: Ctx) => Promise<Response>
Wrap a Next App-Router route handler. Times the call with `performance.now()`, then increments `http_requests_total{route=template, method, status}` and observes `http_request_duration_ms{route=template}`. A thrown error is recorded as `status='500'` and re-thrown.

**Parameters:**
- `template` — the **explicit, bounded** route label; dynamic segments written as `:mapId`, `:systemId`, `:connId`, etc. Never the raw URL (cardinality).
- `handler` — the original handler. Generic over its context so the returned function preserves the exact `{ params: Promise<...> }` shape Next infers (no-param routes infer `unknown`).

**Returns:** a drop-in replacement handler — each `route.ts` exports it as `export const POST = withApiMetrics('/api/...', async (req, ctx) => {...})`.

**Scope:** every handler under `src/app/api/**/route.ts` opts in **except** `/api/metrics` (self-scrape noise), `/api/health` + `/api/health/ready` (frequent external monitor), and `/api/auth/[...nextauth]` (Auth.js owns those exports).

### Depends On
- `./registry` — `recordHttpRequest`.
- `next/server` — `NextRequest` (type only).
