## InstanceAccessPanel

**Purpose:** `/setup` ops-console panel to read/set the instance access mode, manage owner corps/alliances, and manage the instance-scoped allowlist/admin grants.
**File:** `src/components/setup/InstanceAccessPanel.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| config | SerializedInstanceConfig | yes | Server-loaded config; EVE ids + dates as strings |

`SerializedInstanceConfig`, `SerializedOwner`, `SerializedGrant` are exported for the page to shape the server-side `getInstanceConfig()` result into.

### Renders
Three cards: **Access mode** (Restricted/Open toggle buttons), **Owner entities** (list + add form), and **Allowlist & grants** (table + add form). The grants/owners forms use `Select` + `Input`.

### Behaviour & Interactions
- All mutations run through `useTransition`; success/error surfaces as a `sonner` toast. Inputs disable while pending.
- The server actions `revalidatePath('/setup')`, so the page re-renders with fresh rows after each mutation — no local list state is kept.
- The active access-mode button is `variant="default"` and disabled; the other is `outline`.
- Grant capability hint maps `login→allowlist`, `admin→super-admin`.
- The expiry input is `datetime-local`; empty = permanent grant.
- Timestamps (access-mode `updatedAt`, grant `expiresAt`) render through a module-level `Intl.DateTimeFormat('en-US', …)` constant with a fixed locale, so server and client produce identical text and avoid a hydration mismatch (bare `toLocaleString()` picks the runtime default locale, which differs Node↔browser).

### Emits / Calls
- `setupSetAccessMode`, `setupAddOwner`, `setupRemoveOwner`, `setupAddGrant`, `setupRemoveGrant` — all from [[actions]] under `src/app/(setup)/`.

### Depends On
- `Card` / `Button` / `Input` / `Select` shadcn primitives; `sonner` `toast`.
