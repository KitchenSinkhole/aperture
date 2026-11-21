## members.ts

**Purpose:** Admin-panel data loader for `/admin/members`. Returns every `ap_character` row (the panel is global-admin-only), with the moderation + authz fields the action menu needs to decide which controls to show, and the owning account's user API block.
**File:** `src/lib/auth/members.ts`

---

### listAdminMembers(): Promise<AdminMemberRow[]>
Selects every `ap_character` row (unscoped — `/admin` is global-admin-only), joined to its `ap_user` for the account's API block.

Ordering: `(status ASC, name ASC)`. Because the enum is declared `['active', 'kicked', 'banned']` in DB order, an ASC sort puts active rows first, then kicked, then banned. *Within each band* rows alphabetise by name.

Bigints serialised to strings; timestamps to ISO so the row is safe to pass straight from the server component to a client island. `apiBlock` is evaluated at call time with `isUserApiAccountBlocked`, so every character of a blocked account carries the same block and a block that has run out reads as null.

---

### AdminMemberRow (type)
`{ id, name, corporationId, allianceId, status, statusExpiresAt, statusReason, statusChangedAt, authzLevel, lastOnline, lastLocationAt, apiBlock }` — strings for the bigint ids, ISO timestamps, otherwise straight passthrough of the `ap_character` columns the admin UI renders. `apiBlock` is a `UserApiAccountBlock` (`{ reason, until }`, `until` null for indefinite) while the owning account's API block stands, else null.

---

### Depends on
- `apCharacter`, `apUser` — `@/db/schema`.
- `isUserApiAccountBlocked` — `@/lib/userApi/authorize`.

### Notes
- `server-only` import guard — never bundled to the client.
- The dashboard counts in `src/app/(admin)/admin/page.tsx` compute their own `COUNT(*)` queries against `apCharacter` rather than calling this loader; this function is the row-level fetch, not a count surface.
