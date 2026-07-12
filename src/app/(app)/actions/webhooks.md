## webhooks.ts (app actions)

**Purpose:** Map-scoped Server Actions on `ap_map_webhook` rows, gated by the `webhooks_manage` capability, behind the in-map Settings → Webhooks tab.
**File:** `src/app/(app)/actions/webhooks.ts`

---

Access for every action: `requireSession` → `canUseMapFeature(characterId, mapId, 'webhooks_manage')` (manager implicitly, or a corp title delegated the capability). Create gates on the input `mapId`; id-scoped ops resolve `mapId` from the `ap_map_webhook` row first (`gateForWebhook`), returning `'Webhook not found.'` when absent and `'Forbidden.'` when the viewer lacks the capability. No `ap_map_event` is written (webhook config is infra, not map state); no `revalidatePath` (the tab refetches `GET /api/map/[mapId]/webhooks`).

### createWebhook(input): Promise<ActionResult<{ id: string }>>
Insert an `ap_map_webhook` row. Surfaces the `ap_map_webhook_map_channel_event_uq` unique violation as a friendly conflict message.

**Parameters:** `input` — `{ mapId, channel, event, url, username? }` (Zod-validated; `channel`/`event` are the schema enums).

### updateWebhook(input): Promise<ActionResult>
Patch `url` / `username` only (channel + event immutable). No-op when the patch is empty.

**Parameters:** `input` — `{ id, url?, username? }`.

### deleteWebhook(id: string): Promise<ActionResult>
Hard-delete the row (no `active` flag).

### resetWebhookFailures(id: string): Promise<ActionResult>
Zero `consecutive_failures` and clear `last_error`; leaves `last_status` / `last_attempted_at` intact.

### testWebhook(id: string): Promise<ActionResult>
Enqueue a synthetic `webhook-dispatch` job (`{ test: true, webhookId, sentAt }`); the worker calls `runTestWebhookDispatch` and writes back the health columns. Returns once enqueued.
