## SoundPicker

**Purpose:** One event's sound choice in Account settings — a select over the built-in catalog plus a preview button.
**File:** `src/components/account/SoundPicker.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| value | SoundId | yes | The currently chosen sound |
| onValueChange | (id: SoundId) => void | yes | Called with the picked sound id |
| onPreview | () => void | yes | Called when the preview button is clicked |
| disabled | boolean | no | Disables the trigger and the preview button; defaults to false |
| ariaLabel | string | yes | Accessible name for the select; the preview button is named "Preview \<ariaLabel\>" |

### Renders
A compact select showing the sound's label, beside a ghost speaker-icon preview button.

### Behaviour & Interactions
- Options come from `BUILT_IN_SOUNDS` in catalog order.
- A `value` the catalog does not know — an account pref naming a sound stored on another device — is listed as an extra muted "Custom sound" option so the trigger still reads as a selection.

### Depends On
- `BUILT_IN_SOUNDS` from `@/lib/sounds/catalog`
- `Select`, `Button` UI primitives
