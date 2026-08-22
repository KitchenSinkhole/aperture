import 'server-only';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { requireNoteIntelTenant } from '@/lib/system-notes/guard';
import { createSystemNote } from '@/lib/system-notes/mutations';
import { withAuthorName } from '@/lib/system-notes/read';
import { getSystemNoteCategories } from '@/lib/system-notes/vocabulary';
import { requireMapView } from '../map/utils';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * POST /api/system-notes — create a global system-note row.
 *
 * A note row carries no `map_id` and emits no map event — it surfaces on every
 * map showing its system — but it is not deployment-global: the `mapId` in the
 * body is what the row's `scope` triple is derived from, so the caller must be
 * able to view that map *and* belong to the entity that owns it. A guest
 * admitted by a role grant is refused with 403 rather than allowed to write a
 * row they could never read back. The create is recorded in
 * `ap_system_note_event` (inside the mutation) for accountability. See
 * `src/lib/system-notes/*`.
 *
 * `category` is validated against the deployment's vocabulary
 * (`ap_instance.system_note_categories`) at request time — a runtime read, so
 * an admin's vocabulary edit applies without a deploy.
 */

export const runtime = 'nodejs';

const createSystemNoteBodySchema = z.object({
  mapId: z.string().regex(/^\d+$/),
  systemId: z.number().int().positive(),
  body: z.string().min(1).max(2000),
  category: z.string().max(20).nullable().optional(),
  locked: z.boolean().optional(),
});

export const POST = withApiMetrics('/api/system-notes', async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.characterId) {
    return Response.json({ ok: false, error: 'You must be signed in.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 });
  }

  const parsed = createSystemNoteBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' },
      { status: 400 },
    );
  }
  const { mapId, category, ...values } = parsed.data;

  if (category != null) {
    const vocabulary = await getSystemNoteCategories();
    if (!vocabulary.some((c) => c.key === category)) {
      return Response.json({ ok: false, error: 'Unknown category.' }, { status: 400 });
    }
  }

  const guard = await requireMapView(mapId, session);
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }
  const tenant = await requireNoteIntelTenant(guard.mapId, guard.characterId);
  if (!tenant.ok) {
    return Response.json({ ok: false, error: tenant.error }, { status: tenant.status });
  }
  if (!tenant.scope) {
    return Response.json({ ok: false, error: 'Map not found.' }, { status: 404 });
  }

  try {
    const row = await createSystemNote({
      ...values,
      category: category ?? null,
      characterId: guard.characterId,
      scope: tenant.scope,
    });
    const data = await withAuthorName(row);
    return Response.json({ ok: true, data });
  } catch {
    // FK RESTRICT violation (unknown system) or other write error.
    return Response.json(
      { ok: false, error: 'Could not save note — unknown system.' },
      { status: 400 },
    );
  }
});
