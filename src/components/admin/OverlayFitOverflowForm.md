## OverlayFitOverflowForm

**Purpose:** Global-admin radio picker for the instance-wide overlay fit-columns overflow policy — what happens when fitting the system overlay's pilot columns to their content needs more width than the overlay window has.
**File:** `src/components/admin/OverlayFitOverflowForm.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| initialPolicy | OverlayFitOverflow | yes | The stored `ap_instance.overlay_fit_overflow` value the radio group opens on |

### Renders
A radio group of the five policies, each with a one-line explanation, above a Save button. Rendered inside the `/admin/settings` page's overlay section.

### Behaviour & Interactions
- Selection is local until Save; Save posts the whole policy through `adminSetOverlayFitOverflow` inside a transition, disabling every control while pending.
- Success and failure both surface as a `sonner` toast; the server revalidates `/admin/settings`.

### Emits / Calls
- `adminSetOverlayFitOverflow({ policy })` — `@/app/(admin)/actions/settings`

### Depends On
- `Button` (`@/components/ui/button`), `toast` (`sonner`)
- `OverlayFitOverflow` from `@/types`

### Local State
- `policy: OverlayFitOverflow` — the currently selected radio
- `pending: boolean` — `useTransition` flag while the action is in flight
