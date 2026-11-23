## discord.ts

**Purpose:** Discord webhook POST client for the fan-out dispatcher.
**File:** `src/lib/integrations/discord.ts`

---

### isDiscordWebhookUrl(url: string): boolean
`true` only for an `https` URL on `discord.com`, `discordapp.com`, `canary.discord.com` or `ptb.discord.com`, on the default port, with no userinfo, whose path starts `/api/webhooks/`. Unparseable input is `false`. The save-time and send-time gate on map webhook URLs, which any map manager sets and the server POSTs to.

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

Request timeout = `apertureConfig.INTEGRATION_REQUEST_TIMEOUT_MS` (5 s). Redirects are not followed (`redirect: 'manual'`), so a 3xx lands as a terminal non-2xx failure rather than carrying the POST to another host. Does not check the URL itself; callers posting a user-supplied URL gate it with `isDiscordWebhookUrl` first.

---

### Types

- `DiscordWebhookPayload` — `{ content?, username?, embeds? }`.
- `DiscordWebhookEmbed` — `{ title?, description?, color?, timestamp?, fields?, footer? }`.
- `DiscordWebhookEmbedField` — `{ name, value, inline? }`.
- `DiscordDispatchResult` — discriminated union above.
