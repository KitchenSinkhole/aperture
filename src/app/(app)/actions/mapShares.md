## mapShares.ts (app actions)

**Purpose:** Server Actions behind the in-map Settings → Share links tab — mint, list, and revoke the public `/live/<token>` links for one map.
**File:** `src/app/(app)/actions/mapShares.ts`

---

Access for every action: `requireSession` → `canUseMapFeature(characterId, mapId, 'share_manage')` (a manager implicitly, or a corp title delegated the capability). `listShares` / `createMapShare` gate on the input `mapId`; `revokeMapShare` resolves `mapId` from the `ap_map_share` row first. No `revalidatePath` — the tab refetches `listShares` after each mutation.

A share's redaction profile is fixed at mint; there is no update action. Changing what a link exposes means revoking it and issuing a new one, so a URL already in circulation can never widen its disclosure under the recipient.

Mint and revoke each land as one `ap_map_event` (`share.created` / `share.revoked`) via `commitMapEvent`. The token never enters the payload: that envelope reaches every viewer of the map and the Discord history webhook, and the token is a capability URL.

### listShares(mapId: string): Promise<ActionResult<MapShareListItem[]>>
The map's non-revoked share links, newest first (`listMapShares`). Each row carries its raw token so the panel can build the copy-link URL.

### createMapShare(input): Promise<ActionResult<{ token: string }>>
Insert an `ap_map_share` row with a fresh `generateShareToken()` and commit `share.created`. Returns the token so the panel can hand the URL straight to the clipboard.

**Parameters:** `input` — `{ mapId, label, presenceMode, showSignatures, showConnectionSigIds, showBubbles, expiresInHours }` (Zod-validated; `label` 1–60 chars, `presenceMode` is the `share_presence_mode` enum). `expiresInHours` is a positive integer capped at one year, or `null` for no expiry; the absolute `expires_at` is computed server-side so a skewed client clock cannot extend a link.

### revokeMapShare(shareId: string): Promise<ActionResult>
Sets `revoked_at` and closes every live public socket pinned to the token (`revokeShareToken`), then commits `share.revoked`. Access is cut **before** the audit insert, so a failure there still leaves the link dead. Idempotent: an already-revoked share succeeds without a second audit entry. An unknown share id and a share on a map the actor can't manage return the identical `'Share link not found.'` — share ids are sequential, so a distinct "forbidden" would let any signed-in character enumerate which maps have live links.
