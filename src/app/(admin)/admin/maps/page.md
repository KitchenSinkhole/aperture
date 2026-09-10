## AdminMapsPage

**Purpose:** `/admin/maps` — table of every map (global-admin-only; all maps incl. soft-deleted). Each row exposes the destructive action surface (`MapActionsMenu`).
**File:** `src/app/(admin)/admin/maps/page.tsx`

### Renders
A header and a plain HTML table with columns: Name (linked to `/map/<id>` for active rows, struck-through plain text for soft-deleted), Scope, Type, Owner (formatted from the map's owner FK matching its `type`), Created (Intl-formatted date), Status badge (`Active` / `Soft-deleted <date>`), and an action cell hosting only `<MapActionsMenu>` (delete / restore / purge). Per-map settings, webhooks, and audit live in-place on the map (open via the active map's name link), each gated by its own `MapCapability`; this list carries only operator actions.

### Behaviour & Interactions
- `auth()` then `isAdmin(session)`; non-admin redirects to `/maps` (defence in depth — the layout already gated).
- Everyone reaching the page is a global admin, so `canPurge` is always `true` (threaded to each `MapActionsMenu`).
- Server component. No client cache to manage — Server Actions in `MapActionsMenu` `revalidatePath('/admin/maps')` to refresh.

### Depends On
- `auth`, `isAdmin` — `@/lib/auth` / `@/lib/auth/rights`.
- `listAdminMaps` — `@/lib/map/loadMap`.
- `MapActionsMenu` — `@/components/admin/MapActionsMenu`.
