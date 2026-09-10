## MapWebhooksPanel

**Purpose:** Webhooks editor for the in-map Settings → Webhooks tab.
**File:** `src/components/map/manage/MapWebhooksPanel.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| mapId | string | yes | Map whose webhooks are managed |

### Renders
A table (Event / URL masked / Health / Last attempt / actions) plus a create form below; empty-state card when none.

### Behaviour & Interactions
- Fetches `GET /api/map/[mapId]/webhooks` (gated by `webhooks_manage`) on mount and refetches after every mutation (create via `WebhookForm onCreated`, row ops via `WebhookRowActions onChanged`).
- URLs are masked in the table via `maskUrl`; the full URL is kept for the edit form.

### Depends On
- `WebhookForm`, `WebhookRowActions`, `WebhookHealthBadge`
- `GET /api/map/[mapId]/webhooks`
