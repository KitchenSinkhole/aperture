import 'server-only';
import { type NextRequest } from 'next/server';
import { clientKeyFromForwardedFor } from '@/lib/http/clientKey';
import { allowPublicSnapshotRequest, getPublicSnapshot } from '@/lib/map/publicSnapshot';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * GET /api/public/[token]/snapshot
 * The redacted `PublicMapViewData` behind a share token — the only endpoint
 * that serves map data to an anonymous client. No session, no cookie, no
 * `mapId`: the token alone selects the map.
 *
 * Unknown, expired and revoked tokens all answer the same bare 404, so the
 * response never distinguishes "no such token" from "that one was revoked".
 * Rate-limited per client IP and globally before the token is resolved, so
 * guessing costs the guesser rather than the database.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The payload is public but revocable, so it must never sit in a shared cache
// the app cannot purge; the in-process snapshot cache absorbs the load instead.
const PUBLIC_HEADERS = {
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex',
};

function clientKey(request: NextRequest): string {
  return clientKeyFromForwardedFor(
    request.headers.get('x-forwarded-for'),
    request.headers.get('x-real-ip'),
  );
}

export const GET = withApiMetrics(
  '/api/public/:token/snapshot',
  async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    if (!allowPublicSnapshotRequest(clientKey(request))) {
      return Response.json(
        { ok: false, error: 'rate_limited' },
        { status: 429, headers: PUBLIC_HEADERS },
      );
    }

    const { token } = await params;
    const data = await getPublicSnapshot(token);
    if (!data) {
      return Response.json(
        { ok: false, error: 'Not found.' },
        { status: 404, headers: PUBLIC_HEADERS },
      );
    }

    return Response.json({ ok: true, data }, { headers: PUBLIC_HEADERS });
  },
);
