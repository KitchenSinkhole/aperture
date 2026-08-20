import 'server-only';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { requireIntelTenant } from '@/lib/structures/guard';
import { createStructure } from '@/lib/structures/mutations';
import { withTypeName } from '@/lib/structures/read';
import { requireMapView } from '../map/utils';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * POST /api/structures — create a manual structure-intel row.
 *
 * A structure row carries no `map_id` and emits no map event — it surfaces on
 * every map showing its system — but it is not deployment-global: the `mapId` in
 * the body is what the row's `scope` triple is derived from, so the caller must
 * be able to view that map *and* belong to the entity that owns it. A guest
 * admitted by a role grant is refused with 403 rather than allowed to write a row
 * they could never read back. The create is recorded in `ap_structure_event`
 * (inside the mutation) for accountability. See `src/lib/structures/*`.
 */

export const runtime = 'nodejs';

const createStructureBodySchema = z.object({
  mapId: z.string().regex(/^\d+$/),
  systemId: z.number().int().positive(),
  name: z.string().min(1).max(100),
  structureTypeId: z.number().int().positive(),
  ownerCorporationId: z.number().int().positive().nullable().optional(),
  ownerName: z.string().max(100).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const POST = withApiMetrics('/api/structures', async function POST(request: NextRequest) {
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

  const parsed = createStructureBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' },
      { status: 400 },
    );
  }
  const { mapId, ...values } = parsed.data;

  const guard = await requireMapView(mapId, session);
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }
  const tenant = await requireIntelTenant(guard.mapId, guard.characterId);
  if (!tenant.ok) {
    return Response.json({ ok: false, error: tenant.error }, { status: tenant.status });
  }
  if (!tenant.scope) {
    return Response.json({ ok: false, error: 'Map not found.' }, { status: 404 });
  }

  try {
    const row = await createStructure({
      ...values,
      characterId: guard.characterId,
      scope: tenant.scope,
    });
    const data = await withTypeName(row);
    return Response.json({ ok: true, data });
  } catch {
    // FK RESTRICT violation (unknown system or structure type) or other write error.
    return Response.json(
      { ok: false, error: 'Could not save structure — unknown system or structure type.' },
      { status: 400 },
    );
  }
});
