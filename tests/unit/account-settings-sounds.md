## account-settings-sounds.test.tsx

**Purpose:** Component tests for the Sounds section of `src/components/account/AccountSettingsDialog.tsx`, with the account actions mocked and a real sound engine on a silent backend.
**File:** `tests/unit/account-settings-sounds.test.tsx`

Stubs the Base UI-backed `Dialog`, `Avatar` and `Button` primitives so they render inline in jsdom, and replaces `AccountApiTokens` with an empty component (it loads through its own Server Actions; see `account-api-tokens.test.tsx`).

### Covers
- Volume: a keyboard-only change commits without waiting for blur, an unchanged key release does not re-commit, and the slider locks while another control is committing.
- Prefs source: the engine is seeded from the saved prefs, adopts a changed server copy, and keeps an uncommitted edit when the server copy re-renders unchanged.
- Muted systems: the Home pilots mute is pressed by default and a Home toggle saves; a muted system is listed and dropped on remove.
