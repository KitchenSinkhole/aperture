import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { apInstance } from '@/db/schema';
import {
  DEFAULT_SYSTEM_NOTE_CATEGORIES,
  systemNoteCategoriesSchema,
  type SystemNoteCategoryDef,
} from './categories';

/**
 * The deployment's active system-note category vocabulary
 * (`ap_instance.system_note_categories`), falling back to
 * `DEFAULT_SYSTEM_NOTE_CATEGORIES` when unset. The stored jsonb is re-validated
 * defensively — a malformed blob degrades to the default rather than throwing
 * on every note read.
 */
export async function getSystemNoteCategories(): Promise<SystemNoteCategoryDef[]> {
  const [row] = await db
    .select({ categories: apInstance.systemNoteCategories })
    .from(apInstance)
    .where(eq(apInstance.id, 1));
  if (!row?.categories) return DEFAULT_SYSTEM_NOTE_CATEGORIES;
  const parsed = systemNoteCategoriesSchema.safeParse(row.categories);
  return parsed.success ? parsed.data : DEFAULT_SYSTEM_NOTE_CATEGORIES;
}
