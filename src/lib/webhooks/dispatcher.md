## dispatcher.ts

**Purpose:** Single-event Discord webhook dispatcher. Loads one `ap_map_event` row, joins to resolve naming context, fans out to every `ap_map_webhook` row that subscribes to the event class, and writes per-row delivery outcomes back to `ap_map_webhook`. Never throws.
**File:** `src/lib/webhooks/dispatcher.ts`

---

### runWebhookDispatch(mapId: bigint, eventId: bigint, occurredAt: Date): Promise<WebhookDispatchNotes>
Single-event dispatch. Called by the `webhook-dispatch` graphile-worker task with the event coordinates committed by `commitMapEvent`.

**Parameters:**
- `mapId` — the map's `ap_map.id`.
- `eventId` — the event's `ap_map_event.id`.
- `occurredAt` — the event's `ap_map_event.occurred_at`. Passed through to hit the right monthly partition without scanning the whole `ap_map_event` table.

**Returns:** Summary used by `withInstrumentation` to populate `ap_job_run.notes`:
- `attempted` — webhook deliveries attempted (the formatter produced a payload), including ones refused by the URL allowlist.
- `succeeded` / `failed` — per-row outcomes (counted independently of HTTP status semantics).
- `skipped` — configured webhooks whose formatter returned `null` (position-only updates, signature deletes, …).
- `missingEvent` — `true` only when the event row could not be found at dispatch time (event was purged or never existed).

**Behaviour:**
- Validates the event payload against `mapEventPayloadSchema`; malformed payloads end with zeroed counts (defensive — `commitMapEvent` already validates on insert).
- An audit-only kind (`AUDIT_ONLY_EVENT_KINDS`) or an auto-EOL estimate (`isEolEstimateEvent`) ends with zeroed counts before any context is resolved: it is never posted, whatever enqueued it.
- Resolves `WebhookEventContext` once for the event (map name + character name + system / endpoint names) via a small set of joins; reused by every per-webhook formatter call. System / endpoint names come from the `ap_map_system` ids carried in the payload itself — including the audit descriptors now embedded on `connection.delete`/`connection.update` (`source`/`target`), `signature.delete`/`signature.update` (`mapSystemId`), and `signature.create`/`signature.update` (`leadsToMapSystemId` → `targetSystemName`, the link destination) — so a hard-deleted connection / signature still names its endpoints / system. No live `ap_map_connection` join (the row may be gone); `collectSystemRefs` is now pure/synchronous.
- **Blackout:** reads the switch (`getBlackoutState`) at dispatch time; while it is on the actor's name is not loaded and the context carries `hideActor`, so history and rally posts name no actor. Posts already sent are not revisited when it lifts.
- Rally webhooks only fire when `isRallySetEvent(event)` is true (rally-clear and other system updates flow to `history` only).
- **URL allowlist at send time:** every delivery first checks the stored URL with `isDiscordWebhookUrl`. A URL off Discord's webhook hosts is never fetched: the row records a failure (`last_status` null, `last_error` `Not a Discord webhook URL; delivery refused.`, `consecutive_failures` incremented), so a row stored without the save-time check is refused and visibly flagged.
- On success: stamps `last_status`, clears `last_error`, sets `last_attempted_at`, resets `consecutive_failures` to 0.
- On failure: stamps `last_status`/`last_error`/`last_attempted_at`, increments `consecutive_failures`. Never throws (graphile-worker would re-deliver to webhooks that already succeeded, causing duplicates).
- Every `deliver()` (real and test-fire) records `webhook_deliveries_total{target='discord', outcome}` — outcome mapped from the Discord result: `success` / `rate_limited` (429) / `http_5xx` / `http_4xx` / `network_error` (no status), or `blocked_url` for a URL refused by the allowlist.

---

### runTestWebhookDispatch(webhookId: bigint, sentAt: Date): Promise<WebhookDispatchNotes>
Admin test-fire. Sends a synthetic `[test]` message to one `ap_map_webhook` row, writing back `last_status` / `last_error` / `last_attempted_at` / `consecutive_failures` exactly like a real dispatch — so a green test fire is identical evidence to a green real send.

**Parameters:**
- `webhookId` — `ap_map_webhook.id`.
- `sentAt` — caller's wall-clock; echoed into the rendered Discord message so the operator can match the test they triggered to the one that landed.

**Returns:** `WebhookDispatchNotes` with `test: true`. `missingWebhook: true` when the row no longer exists. Never throws.

---

### Types

- `WebhookDispatchNotes` — return shape; mirrors what `ap_job_run.notes` stores. `test`/`missingWebhook` flags only set by `runTestWebhookDispatch`.

### Constants

- `LAST_ERROR_MAX` (500) — `last_error` text is truncated to this many characters before storing.
