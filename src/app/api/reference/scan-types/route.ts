import 'server-only';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { classifyScanTypes } from '@/lib/eve/shipTypes';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * POST /api/reference/scan-types
 * Classify the type ids one D-Scan reported, so the overlay can tell ships from
 * everything else a scan lists alongside them — capsules count as ships, being
 * in that category. An id the SDE does not carry is simply absent from the
 * reply, which the caller reads as "too new to classify" rather than "not a
 * ship". Static reference data — not map-scoped, so any signed-in character may
 * read it; 401 when logged out.
 */

export const runtime = 'nodejs';

// A single D-Scan is bounded by what fits in range; well past that, the request
// is malformed rather than a scan.
const MAX_SCAN_TYPES = 2000;

const bodySchema = z.object({
  typeIds: z.array(z.number().int().positive()).max(MAX_SCAN_TYPES),
});

export const POST = withApiMetrics(
  '/api/reference/scan-types',
  async function POST(request: NextRequest) {
    const session = await getSession();
    if (!session?.characterId) {
      return Response.json({ ok: false, error: 'Not authenticated.' }, { status: 401 });
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return Response.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' },
        { status: 400 },
      );
    }

    const data = await classifyScanTypes(parsed.data.typeIds);
    return Response.json({ ok: true, data });
  },
);
