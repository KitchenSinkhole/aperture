## SystemNoteCategoriesForm

**Purpose:** Global-admin editor for the system-note category vocabulary at `/admin/settings`.
**File:** `src/components/admin/SystemNoteCategoriesForm.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| initial | SystemNoteCategoryDef[] | yes | The current vocabulary (`getSystemNoteCategories`) |

### Renders
A column of rows — key input + chip-colour `Select` + remove button — with an "Add category" button (capped at `MAX_SYSTEM_NOTE_CATEGORIES`) and Save.

### Behaviour & Interactions
- Keys lowercase as typed. The last remaining row cannot be removed (the schema requires ≥1 entry).
- Save validates locally with `systemNoteCategoriesSchema` (the same shape the server enforces) so errors surface before the round-trip, then calls `adminSetSystemNoteCategories`; sonner toasts the outcome.
- Removing a key never rewrites notes — stored legacy keys render as neutral chips in the panel.

### Depends On
- `adminSetSystemNoteCategories` (`@/app/(admin)/actions/settings`).
- `systemNoteCategoriesSchema` / `SYSTEM_NOTE_CHIP_COLORS` / `MAX_SYSTEM_NOTE_CATEGORIES` (`@/lib/system-notes/categories`).
- `Select` primitives, `Button`.

### Local State
- `rows: { key, color }[]`, `pending` (transition).
