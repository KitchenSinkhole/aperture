'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { apInstance } from '@/db/schema';
import { auth } from '@/lib/auth';
import { isAdmin } from '@/lib/auth/rights';

/**
 * Admin instance-settings actions, exposed at `/admin/settings`. Global-admin
 * only — these are deployment-wide knobs on `ap_instance`.
 *
 * No `ap_map_event` row is written — instance config is not map state. The
 * panel is refreshed via `revalidatePath('/admin/settings')`.
 */

type ActionResult = { ok: true } | { ok: false; error: string };

// One week, in minutes — a generous upper bound for the stale-signature default.
const MAX_STALE_THRESHOLD_MINUTES = 7 * 24 * 60;

const staleThresholdSchema = z.object({
  minutes: z.number().int().min(1).max(MAX_STALE_THRESHOLD_MINUTES),
});

/**
 * Set the instance-wide default stale-signature threshold (`ap_instance`),
 * gated to global admins. Per-account overrides (capped at this value) live on
 * `ap_user`.
 */
export async function adminSetStaleSignatureThreshold(
  input: z.input<typeof staleThresholdSchema>,
): Promise<ActionResult> {
  const parsed = staleThresholdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };

  const session = await auth();
  if (!(await isAdmin(session))) return { ok: false, error: 'Forbidden.' };

  await db
    .update(apInstance)
    .set({ staleSignatureThresholdMinutes: parsed.data.minutes, updatedAt: new Date() })
    .where(eq(apInstance.id, 1));

  revalidatePath('/admin/settings');
  return { ok: true };
}
