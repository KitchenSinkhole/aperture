## BlackoutPanel

**Purpose:** Global-admin card on `/admin/settings` for the instance-wide Blackout switch and its cleared list.
**File:** `src/components/admin/BlackoutPanel.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| data | BlackoutPanelData | yes | Server-loaded switch state, cleared list and picker options (`adminLoadBlackoutPanel`) |

### Renders
One card with three parts:
- **Switch:** On (since when, turned on by whom) or Off, with a Turn on / Turn off button.
- **Cleared list:** a table of name, kind (Character / Corp title), corp (titles only), expiry (`Never`, or the date, with `(expired)` when the entry's `expired` flag is set), note, and a Remove button. An empty list says global admins always see pilots.
- **Add controls:** a kind select; for a character, a name input backed by a `<datalist>` of known characters; for a title, a corporation select then a title select over that corp's titles (or a hint when no titles are known); optional expiry (`datetime-local`) and note; Add.

### Behaviour & Interactions
- Turning Blackout on opens a confirmation dialog; turning it off does not.
- A character is resolved by an exact, case-insensitive name match against the picker list; a name outside it is refused with a toast before any server call.
- The expiry is entered in the viewer's local time and sent as the ISO instant it names.
- Changing the corporation clears the chosen title. A successful add clears the form.
- All mutations run in a transition; success and failure surface as `sonner` toasts and the controls disable while pending. No local list state is kept: the actions revalidate the page.
- Dates render through a fixed-locale `Intl.DateTimeFormat`, so server and client text match.

### Emits / Calls
- `adminStartBlackout`, `adminEndBlackout`, `adminAddBlackoutClearance`, `adminRemoveBlackoutClearance` — from `@/app/(admin)/actions/blackout`.

### Depends On
- `Button`, `Dialog`, `Input`, `Select` UI primitives; `sonner` toast.
- Types: `BlackoutPanelData`, `BlackoutClearance`, `BlackoutTitleOption` (`@/types`).
