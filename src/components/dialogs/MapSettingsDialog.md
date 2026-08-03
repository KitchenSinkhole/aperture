## MapSettingsDialog

**Purpose:** Consolidated map edit / settings / management / import-export dialog, launched from the `MapCanvas` toolbar.
**File:** `src/components/dialogs/MapSettingsDialog.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| open | boolean | yes | Controlled open state. |
| onOpenChange | (open: boolean) => void | yes | Open-state setter. |
| mapId | string | yes | The open map's id. |
| settings | MapSettings | yes | Seed values (name/icon/scope/type + behavior/tagging flags) from `loadMapSettings`. |
| canManage | boolean | yes | Derived `canManageMap` — reveals the manager-only Roles & Permissions tab. |
| capabilities | MapCapability[] | yes | Delegated capabilities the viewer holds (`resolveMapCapabilities`; a manager holds all) — reveals each management tab. |
| systems | { id; name; alias }[] | yes | Visible map systems for the Auto-tagging Home picker. |
| onImported | (payloads: MapEventPayload[]) => void | yes | Folds imported event payloads onto the live canvas (wired to the canvas's `onBulkPaste`). |

### Renders
A tabbed dialog (`Tabs`): **General** (name + icon inputs, read-only scope/visibility) and **Settings** (per-device display preferences — low-contrast theme toggle plus wormhole-type-picker grouping toggles) always show. Each management tab is revealed by the viewer's capability: **Behavior** + **Auto-tagging** (`settings_manage`, `MapBehaviorForm` / `MapTaggingForm`), **Webhooks** (`webhooks_manage`, `MapWebhooksPanel`), **Share links** (`share_manage`, `MapSharePanel`), **Export** (`map_export`), **Import** (`map_import`). **Roles & Permissions** (`MapRolesForm`) shows only for a manager (`canManage`).

### Behaviour & Interactions
- General Save → `updateMapSettingsAction({ mapId, name, icon })` (`map_update`); empty icon trims to `null`. A name change reflects live on the canvas via the realtime `map.update` echo.
- Settings tab — per-device display preferences (no server round-trip). The **Low-contrast theme** checkbox reads/writes `aperture:low-contrast` via `readLowContrast`/`writeLowContrast` (`@/lib/lowContrast`), which toggles the `low-contrast` class on `<html>` live; off by default. A lazy `useState(readLowContrast)` initializer seeds the checkbox from localStorage on first render — safe because the panel only mounts once the dialog is opened (never during SSR). The root-layout inline script independently applies the class to `<html>` before paint on reload.
- Settings tab also holds the wormhole-type-picker pref (`readWhPickerPrefs`/`writeWhPickerPrefs`, `@/lib/wormholePickerPrefs`): **Group wormhole types by category** (`grouped`, on by default), where the grouped view also orders wandering & frig holes by class. Writing notifies the prefs store, so open `WormholeTypeSelect` dropdowns re-render immediately.
- Export → `exportMapOnServer({ mapId })`; on success builds a `Blob` and triggers a download named `aperture-map-<id>-<YYYY-MM-DD>.json`.
- Import → reads the chosen file, `JSON.parse`s it, posts via `importMapOnServer`; on success calls `onImported(payloads)` and toasts a summary, then resets the file input. Invalid JSON / schema-invalid files toast an error (the client wrapper handles HTTP errors).
- Scope/type are shown read-only (immutable post-create).
- **Management tabs** are revealed per delegated capability (`capabilities`) — a manager holds all; a delegated title-holder sees only the tabs for the features granted to their title. Every tab is re-checked server-side by its capability regardless of what the UI shows. **Roles & Permissions** (delegating features to titles) is manager-only and corp-map-only; on private/alliance maps `MapRolesForm` renders an unavailable note. The audit log lives in its own wider dialog (`MapAuditDialog`), not here.

### Emits / Calls
- `updateMapSettingsAction`, `exportMapOnServer`, `importMapOnServer`.
- `onImported(payloads)` after a successful import.

### Depends On
- `Dialog`, `Tabs`, `Button`, `Input` primitives; `sonner` toasts; lucide `Download`/`Save`/`Upload`.
- `@/lib/lowContrast` — `readLowContrast` / `writeLowContrast` for the Settings-tab low-contrast toggle.
- `@/lib/wormholePickerPrefs` — `readWhPickerPrefs` / `writeWhPickerPrefs` for the Settings-tab wormhole-picker grouping toggle.
- `MapBehaviorForm`, `MapTaggingForm`, `MapWebhooksPanel`, `MapSharePanel`, `MapRolesForm` (`@/components/map/manage/*`) — the management tabs.
