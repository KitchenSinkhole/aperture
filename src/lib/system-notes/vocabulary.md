## vocabulary.ts

**Purpose:** Server-side read of the deployment's active system-note category vocabulary.
**File:** `src/lib/system-notes/vocabulary.ts`

---

### getSystemNoteCategories(): Promise<SystemNoteCategoryDef[]>
`ap_instance.system_note_categories`, falling back to `DEFAULT_SYSTEM_NOTE_CATEGORIES` when unset. The stored jsonb is re-validated defensively (`systemNoteCategoriesSchema.safeParse`) — a malformed blob degrades to the default rather than throwing on every note read.
