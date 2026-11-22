## discord-webhook.test.ts

**Purpose:** DB-free unit test for the Discord webhook client (`src/lib/integrations/discord.ts`), with `fetch` stubbed.
**File:** `tests/unit/discord-webhook.test.ts`

### Covers
- Every POST carries `allowed_mentions: { parse: [] }` beside the caller's payload, so `@everyone`, `@here` and role mentions in message text ping no one.
