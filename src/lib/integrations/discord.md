## discord.ts

**Purpose:** Discord webhook POST client for the fan-out dispatcher.
**File:** `src/lib/integrations/discord.ts`

---

### postDiscordWebhook(url: string, payload: DiscordWebhookPayload): Promise<DiscordDispatchResult>
POSTs `payload` to a Discord webhook URL with `allowed_mentions: { parse: [] }`, so no `@everyone`, `@here`, user or role mention in the text pings anyone. Never throws — every failure maps to a `{ ok: false }` result with a `retriable` flag so the dispatcher can decide whether to surface it as a terminal record or as a thrown error that graphile-worker will retry.

**Parameters:**
- `url` — full Discord webhook URL (`https://discord.com/api/webhooks/<id>/<token>`).
- `payload` — `{ content?, username?, embeds? }`. At least one of `content` or `embeds` must be set.

**Returns:**
- `{ ok: true, status }` on 2xx.
- `{ ok: false, status: 429, retriable: true, retryAfterSeconds? }` on rate limit.
- `{ ok: false, status, error, retriable: status >= 500 }` on other non-2xx.
- `{ ok: false, error, retriable: true }` on network / timeout failure (no status).

Request timeout = `apertureConfig.INTEGRATION_REQUEST_TIMEOUT_MS` (5 s).

---

### Types

- `DiscordWebhookPayload` — `{ content?, username?, embeds? }`.
- `DiscordWebhookEmbed` — `{ title?, description?, color?, timestamp?, fields?, footer? }`.
- `DiscordWebhookEmbedField` — `{ name, value, inline? }`.
- `DiscordDispatchResult` — discriminated union above.
