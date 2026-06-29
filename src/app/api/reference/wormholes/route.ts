import 'server-only';
import { getSession } from '@/lib/session';
import { wormholeJumpInfo } from '@/lib/eve/wormholeJumpInfo';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * GET /api/reference/wormholes
 * Returns the full wormhole jump reference catalog (code, classes, mass,
 * lifetime, sig strength) for the Jump Info dialog. Static reference data — not
 * map-scoped, so any signed-in character may read it; 401 when logged out.
 */

export const runtime = 'nodejs';

export const GET = withApiMetrics('/api/reference/wormholes', async function GET() {
  const session = await getSession();
  if (!session?.characterId) {
    return Response.json({ ok: false, error: 'Not authenticated.' }, { status: 401 });
  }

  const data = await wormholeJumpInfo();
  return Response.json({ ok: true, data });
});
