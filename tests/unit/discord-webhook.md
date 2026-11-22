## discord-webhook.test.ts

**Purpose:** DB-free unit test for the Discord webhook client (`src/lib/integrations/discord.ts`), with `fetch` stubbed.
**File:** `tests/unit/discord-webhook.test.ts`

### Covers
- Every POST carries `allowed_mentions: { parse: [] }` beside the caller's payload, so `@everyone`, `@here` and role mentions in message text ping no one.
- A redirect is not followed: the request is sent with `redirect: 'manual'` and a 3xx comes back as a terminal failure.
- `isDiscordWebhookUrl` accepts the four Discord webhook hosts (case-insensitive, query string allowed) and rejects plain `http`, an explicit port, a trailing-dot host, look-alike hosts, userinfo, a non-webhook Discord path, Slack, metadata and localhost addresses, and unparseable input.
