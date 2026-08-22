## categories.ts

**Purpose:** The system-note category vocabulary contract — built-in default, closed chip-colour palette keys, and the Zod shape both the admin write and the defensive read validate against. Client-safe (no DB access; that is `vocabulary.ts`).
**File:** `src/lib/system-notes/categories.ts`

---

### SYSTEM_NOTE_CHIP_COLORS / SystemNoteChipColor
The closed chip palette keys (`sky`, `violet`, `emerald`, `amber`, `red`, `orange`, `blue`, `cyan`, `pink`, `gray`). `SystemNotesModule` maps each to literal Tailwind classes.

### SystemNoteCategoryDef
`{ key: string; color: SystemNoteChipColor }` — one vocabulary entry. Keys are short lowercase slugs, stored verbatim on notes and rendered verbatim as chips.

### DEFAULT_SYSTEM_NOTE_CATEGORIES
The vocabulary a deployment starts with (`intel`/sky, `journal`/violet, `bounty`/emerald, `logistics`/amber, `warning`/red); active while `ap_instance.system_note_categories` is NULL.

### MAX_SYSTEM_NOTE_CATEGORIES
Vocabulary size cap (12).

### systemNoteCategoriesSchema
Zod: 1–12 entries of `{ key: /^[a-z0-9][a-z0-9-]{0,19}$/, color: palette enum }`, keys unique.
