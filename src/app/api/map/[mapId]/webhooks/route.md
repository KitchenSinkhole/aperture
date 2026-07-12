## GET /api/map/[mapId]/webhooks

**Purpose:** Read-only webhook list feeding the in-map Settings → Webhooks tab.
**File:** `src/app/api/map/[mapId]/webhooks/route.ts`

---

### GET(request, { params: { mapId } })
Returns the map's `ap_map_webhook` rows ordered by `(event, id)`.

**Access:** the `webhooks_manage` capability via `requireMapCapability(rawMapId, session, 'webhooks_manage')` (`../../utils`) — a manager holds it implicitly, and a corp title granted it in `ap_map_role_access` holds it too. 404 on missing/unviewable map (no existence leak); 403 for a viewer with only view access. Mirrors the gate on the webhook Server Actions.

**Returns:** `{ ok: true, data: { webhooks } }` where each webhook is `{ id, channel, event, url, username, lastStatus, lastError, lastAttemptedAt, consecutiveFailures }`. The **full** `url` is returned (a map manager needs it to edit); the client masks it in the table.

Runtime: `nodejs`.
