import { z } from 'zod';

/**
 * The system-note category vocabulary contract. The active vocabulary is a
 * per-deployment instance setting (`ap_instance.system_note_categories`, edited
 * at `/admin/settings`); this module carries the built-in default, the closed
 * chip-colour palette keys, and the Zod shape both the admin write and the
 * defensive read validate against. Client-safe — no DB access here (that is
 * `vocabulary.ts`).
 */

/** The closed chip palette. `SystemNotesModule` maps each key to literal classes. */
export const SYSTEM_NOTE_CHIP_COLORS = [
  'sky',
  'violet',
  'emerald',
  'amber',
  'red',
  'orange',
  'blue',
  'cyan',
  'pink',
  'gray',
] as const;

export type SystemNoteChipColor = (typeof SYSTEM_NOTE_CHIP_COLORS)[number];

/** One entry of the vocabulary: the stored key and its chip colour. */
export type SystemNoteCategoryDef = { key: string; color: SystemNoteChipColor };

/** The vocabulary a deployment starts with (`ap_instance.system_note_categories` NULL). */
export const DEFAULT_SYSTEM_NOTE_CATEGORIES: SystemNoteCategoryDef[] = [
  { key: 'intel', color: 'sky' },
  { key: 'journal', color: 'violet' },
  { key: 'bounty', color: 'emerald' },
  { key: 'logistics', color: 'amber' },
  { key: 'warning', color: 'red' },
];

export const MAX_SYSTEM_NOTE_CATEGORIES = 12;

/**
 * Shape of the stored vocabulary. Keys are short lowercase slugs (they render
 * verbatim as chips and are stored on notes as-is); colours come from the
 * closed palette; keys are unique.
 */
export const systemNoteCategoriesSchema = z
  .array(
    z.object({
      key: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{0,19}$/, 'Keys are 1–20 lowercase letters, digits or hyphens.'),
      color: z.enum(SYSTEM_NOTE_CHIP_COLORS),
    }),
  )
  .min(1)
  .max(MAX_SYSTEM_NOTE_CATEGORIES)
  .refine((list) => new Set(list.map((c) => c.key)).size === list.length, {
    message: 'Duplicate category keys.',
  });
