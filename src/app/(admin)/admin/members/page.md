## AdminMembersPage

**Purpose:** `/admin/members` — table of every character (the panel is global-admin-only) with the moderation action surface (`MemberActionsMenu`).
**File:** `src/app/(admin)/admin/members/page.tsx`

### Renders
A header and an HTML table with columns: Name, Corp (`corporationId` string or em-dash), Level (authz badge — admin pill or plain "Member" text), Status (status badge — `Active` neutral pill, `Kicked (until <date>)` amber pill with reason on hover, `Banned` destructive pill with reason on hover, followed on every character of an API-blocked account by an `API blocked` destructive pill with its end and reason on hover), Last seen (`lastLocationAt` formatted, em-dash when null), and the per-row action cell.

### Behaviour & Interactions
- `auth()` then `isAdmin(session)`; non-admin redirects to `/maps` (defence in depth — the layout already gates).
- Rows order by `(status, name)` — DB enum order puts active first, then kicked, then banned; banned rows sink to the bottom.
- Server component. Action menus are client islands that `revalidatePath('/admin/members')` on success.

### Depends On
- `auth`, `isAdmin` — `@/lib/auth` / `@/lib/auth/rights`.
- `listAdminMembers` — `@/lib/auth/members`.
- `MemberActionsMenu` — `@/components/admin/MemberActionsMenu`.
