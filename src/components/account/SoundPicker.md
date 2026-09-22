## SoundPicker

**Purpose:** One event's sound choice in Account settings — a select over the chimes, the voice packs and this device's imported sounds, plus a preview button.
**File:** `src/components/account/SoundPicker.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| event | SoundEvent | yes | Which cue this row configures; picks each pack's line for it |
| value | SoundId | yes | The currently chosen sound |
| onValueChange | (id: SoundId) => void | yes | Called with the picked sound id |
| onPreview | () => void | yes | Called when the preview button is clicked |
| disabled | boolean | no | Disables the trigger and the preview button; defaults to false |
| ariaLabel | string | yes | Accessible name for the select; the preview button is named "Preview \<ariaLabel\>" |

### Renders
A compact select showing the sound's label, beside a ghost speaker-icon preview button.

### Behaviour & Interactions
- Options are up to three groups: "Chimes" listing all of `CHIME_SOUNDS`, "Voice packs" listing one entry per pack, labelled with the pack's name, and "Your sounds" listing this device's imported sounds, omitted when there are none. Only `event`'s line from each pack is offered, so a pack is one row per select rather than one per cue.
- A `value` neither the catalog nor this device knows — an account pref naming a sound imported on another device — is listed as an extra muted "Custom sound" option so the trigger still reads as a selection.

### Depends On
- `CHIME_SOUNDS`, `voiceSoundsForEvent` from `@/lib/sounds/catalog`
- `useCustomSounds` from `@/lib/sounds/customStore`
- `Select`, `Button` UI primitives
