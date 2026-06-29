import 'server-only';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { requireStructureMutate } from '@/lib/structures/guard';
import { createStructure } from '@/lib/structures/mutations';
import { withTypeName } from '@/lib/structures/read';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * POST /api/structures — create a manual structure-intel row.
 *
 * Structure intel is deployment-global (no `map_id`), so this is a plain REST
 * resource: it does NOT emit a map event and any authenticated user may write.
 * The create is recorded in `ap_structure_event` (inside the mutation) for
 * accountability. See `src/lib/structures/*`.
 */

export const runtime = 'nodejs';

const createStructureBodySchema = z.object({
  systemId: z.number().int().positive(),
  name: z.string().min(1).max(100),
  structureTypeId: z.number().int().positive(),
  ownerCorporationId: z.number().int().positive().nullable().optional(),
  ownerName: z.string().max(100).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const POST = withApiMetrics('/api/structures', async function POST(request: NextRequest) {
  const session = await getSession();
  const guard = requireStructureMutate(session);
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
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

  try {
    const row = await createStructure({ ...parsed.data, characterId: guard.characterId });
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
