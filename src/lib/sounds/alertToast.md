## alertToast.ts

**Purpose:** Whether an experimental alert row should show an in-app toast (row enabled + toast opt-in).
**File:** `src/lib/sounds/alertToast.ts`

---

### shouldShowExperimentalAlertToast(prefs: SoundEventPrefs): boolean
True when `enabled` and `toast === true`; ignores master sound and per-system mutes.