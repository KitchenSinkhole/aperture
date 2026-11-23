## AccountSettingsDialog

**Purpose:** Account self-service dialog — pick the account's main character (with per-character role display), toggle preferences (travel animation, signature indicators, sound cues), see and revoke the account's API tokens, and reach account deletion.
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
| soundPrefs | SoundPrefs | yes | The account's saved sound preferences (master switch, volume, per-event enable + sound id); pushed into the engine whenever its content changes |

### Renders
A roster list — each row shows portrait, name, role label (Member / Manager / Admin), and either a "Main" marker (current main), the kicked/banned status, or a "Set as main" button. Below it, an **Experimental UI** fieldset when experimental is active, a "Show connection travel animation" checkbox row, a "Signature indicators" section (two toggles + a "Mark stale after" hours input), a **Sounds** or **Sounds & notifications** section (master checkbox, volume slider, per-`SoundEvent` rows — standard rows use enable + `SoundPicker`; experimental alert rows add Sound / Toast / Desktop controls; then **Muted systems** with Home row and per-system mute chips), a "Your sounds" block, `AccountApiTokens`, then a destructive-bordered "Delete account" section embedding `DeleteAccountDialog`. Everything below the header sits in a scrolling body within a capped dialog height, so the title and close button stay pinned.

### Behaviour & Interactions
- `mainId` is local optimistic state seeded from `mainCharacterId`; clicking "Set as main" calls `setMainCharacterAction` in a transition and moves the marker on success, toasting on failure.
- Only `active` characters that aren't already main are selectable; the in-flight transition disables all set-main buttons.
- `travelOn` is local optimistic state seeded from `travelAnimation`; toggling the checkbox calls `setConnectionTravelAnimationAction` in a transition, reverting + toasting on failure. Both transitions share the one `pending` flag.
- Sound prefs live in the engine, not in dialog state: the section renders `useSoundPrefs()` and every edit goes through `getSoundEngine().setPrefs`, so the engine, the map's cue surfaces and the dialog all read one copy. Every control persists the whole blob through `saveSoundPrefs` (`@/lib/sounds/savePrefs`), which rolls back and toasts on failure. This dialog and the map's `SystemSoundMuteItem` are the engine's only `setPrefs` writers. Enabling an event, or picking a sound for it, previews that sound — `engine.preview` bypasses the master switch and mute, so the picker and its preview button stay live with sounds off. The volume slider, the per-event checkboxes and the mute chips are disabled while the master switch is off, and every control in the section is disabled while a commit is in flight.
- Experimental UI: the sounds block is titled **Sounds & notifications** when `ap_ui` is on; alert rows expose separate Sound, Toast, and Desktop notification toggles; legacy device alert keys migrate on first open via `migrateLegacyExperimentalAlerts`.
- Signature-indicator prefs (`showStale`, `showUnscanned`, `thresholdHours`) are local optimistic state. `commitSigPrefs(next)` persists all three at once via `setSignatureIndicatorPrefsAction`; failure rolls all three back and toasts.

### Emits / Calls
- `setMainCharacterAction(id)`, `setConnectionTravelAnimationAction(enabled)`, `setSignatureIndicatorPrefsAction({ thresholdMinutes, showStale, showUnscanned })` — from `@/app/(app)/actions/account`
- `saveSoundPrefs(next, prev)` — from `@/lib/sounds/savePrefs`
- `setSystemSoundMute(...)`, `removeSystemSoundMute(...)` — from `@/lib/sounds/prefs`
- `getSoundEngine().setPrefs(prefs)` / `.preview(soundId)`, `useSoundPrefs()` — from `@/lib/sounds/engine`
- `subscribeSoundPrefs(listener)` — from `@/lib/sounds/prefsSync`
- `getCustomSoundStore().add(file)` / `.remove(id)`, `useCustomSounds()` — from `@/lib/sounds/customStore`

### Depends On
- `@/lib/experimentalUi.client` — `useExperimentalUi`
- `AccountApiTokens` — the account's API tokens on every map, with revoke and the block banner
- `DeleteAccountDialog` — the type-to-confirm deletion flow
- `SoundPicker` — the per-event sound select + preview button
- `Dialog`, `Avatar`, `Button` UI primitives

### Exports
- `AccountCharacter` type — `{ id; name; status; authzLevel }`, the roster row shape.