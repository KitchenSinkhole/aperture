import 'server-only';
import { getSession } from '@/lib/session';
import { wormholeCatalog } from '@/lib/map/wormholeTypes';

/**
 * GET /api/wormhole-types — the full wormhole catalog for the signature
 * inspector's WH-type dropdown. Static SDE reference data, identical for every
 * system; any authenticated user may read it (like `/api/structure-types`). The
 * client fetches it once per session and derives per-system class grouping
 * locally (`annotateWormholeTypes`).
 */

export const runtime = 'nodejs';

export async function GET() {
  const session = await getSession();
  if (!session?.characterId) {
    return Response.json({ ok: false, error: 'You must be signed in.' }, { status: 401 });
  }
  const data = await wormholeCatalog();
  return Response.json({ ok: true, data });
}
