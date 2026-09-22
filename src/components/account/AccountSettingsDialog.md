## AccountSettingsDialog

**Purpose:** Account self-service dialog — pick the account's main character (with per-character role display), toggle preferences (travel animation, signature indicators, sound cues), and reach account deletion.
**File:** `src/components/account/AccountSettingsDialog.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| open | boolean | yes | Controlled open state |
| onOpenChange | (open: boolean) => void | yes | Open-state setter (owned by `CharacterPanel`) |
| characters | AccountCharacter[] | yes | The account roster (`id`, `name`, `status`, `authzLevel`) |
| mainCharacterId | string \| null | yes | Current main; `null` until bootstrapped on first login |
| activeCharacter | { id: string; name: string } | yes | The signed-in character; its name is the delete confirmation phrase |
| travelAnimation | boolean | yes | Initial state of the connection-travel-animation toggle |
| signatureIndicators | SignatureIndicatorAccountSettings | yes | Global cap + the account's override (`null` = use default) + the two toggles |
| soundPrefs | SoundPrefs | yes | The account's sound preferences (master switch, volume, per-event enable + sound id) |

### Renders
A roster list — each row shows portrait, name, role label (Member / Manager / Admin), and either a "Main" marker (current main), the kicked/banned status, or a "Set as main" button. Below it, a "Show connection travel animation" checkbox row, a "Signature indicators" section (two toggles + a "Mark stale after" hours input), a "Sounds" section (master checkbox, volume slider, one row per `SoundEvent` with an enable checkbox and a `SoundPicker`, then a "Your sounds" block with an "Add file" button and one row per imported sound carrying a preview and a remove button), then a destructive-bordered "Delete account" section embedding `DeleteAccountDialog`. Everything below the header sits in a scrolling body within a capped dialog height, so the title and close button stay pinned.

### Behaviour & Interactions
- `mainId` is local optimistic state seeded from `mainCharacterId`; clicking "Set as main" calls `setMainCharacterAction` in a transition and moves the marker on success, toasting on failure.
- Only `active` characters that aren't already main are selectable; the in-flight transition disables all set-main buttons.
- `travelOn` is local optimistic state seeded from `travelAnimation`; toggling the checkbox calls `setConnectionTravelAnimationAction` in a transition, reverting + toasting on failure. Both transitions share the one `pending` flag.
- Sound prefs are one local optimistic `SoundPrefs` blob; every control persists the whole blob through `setSoundPrefsAction`, rolling back and toasting on failure. An effect pushes the on-screen blob into `getSoundEngine().setPrefs`, so a preview auditions what the dialog shows rather than what was last saved. This dialog is the engine's **only** `setPrefs` writer: `CharacterPanel` mounts it (closed) on every authenticated page, so the engine holds the account's prefs wherever a cue can fire, and no other surface can overwrite the optimistic blob with a staler server copy. Volume commits on pointer release, key release and blur rather than per drag frame, so it is the one field that can sit ahead of the server; a rollback restores the last committed volume. Enabling an event, or picking a sound for it, previews that sound — `engine.preview` bypasses the master switch and mute, so the picker and its preview button stay live with sounds off. The volume slider and the per-event checkboxes are disabled while the master switch is off, and every control in the section is disabled while a commit is in flight, so two sound commits can never overlap and a rollback can only ever undo the newest one. Event labels and descriptions come from `SOUND_EVENT_LABELS`.
- "Your sounds" is device state, not account state: it reads `useCustomSounds()` and writes through `getCustomSoundStore()`, outside the `SoundPrefs` blob and outside the `pending` transition. The "Add file" button opens a hidden `audio/*` file input, which is cleared after every pick so re-choosing the same file fires again; a rejected import toasts the store's reason and an accepted one previews itself straight away. Removing a sound an event still names leaves the pref alone — the engine falls back to that event's default chime.
- Signature-indicator prefs (`showStale`, `showUnscanned`, `thresholdHours`) are local optimistic state. `commitSigPrefs(next)` persists all three at once (the action takes the full set): the hours field is parsed, clamped client-side to `[1 min, globalThresholdMinutes]`, converted to minutes (blank ⇒ `null` = use default), then sent via `setSignatureIndicatorPrefsAction`; failure rolls all three back and toasts. The threshold input is disabled when `showStale` is off. Server re-validates the cap.

### Emits / Calls
- `setMainCharacterAction(id)`, `setConnectionTravelAnimationAction(enabled)`, `setSignatureIndicatorPrefsAction({ thresholdMinutes, showStale, showUnscanned })`, `setSoundPrefsAction(prefs)` — from `@/app/(app)/actions/account`
- `getSoundEngine().setPrefs(prefs)` / `.preview(soundId)` — from `@/lib/sounds/engine`
- `getCustomSoundStore().add(file)` / `.remove(id)`, `useCustomSounds()` — from `@/lib/sounds/customStore`

### Depends On
- `DeleteAccountDialog` — the type-to-confirm deletion flow
- `SoundPicker` — the per-event sound select + preview button
- `Dialog`, `Avatar`, `Button` UI primitives

### Exports
- `AccountCharacter` type — `{ id; name; status; authzLevel }`, the roster row shape.
