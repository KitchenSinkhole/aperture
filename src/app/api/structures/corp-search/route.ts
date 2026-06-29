import 'server-only';
import { type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { searchCorporations } from '@/lib/structures/corpSearch';
import { EsiHttpError, EsiTokenError } from '@/lib/esi/client';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * GET /api/structures/corp-search?q=<query> — corporation name autocomplete for
 * the structure-intel owner picker. Returns `{ ok, data: CorpSearchResult[] }`.
 *
 * Any signed-in user may search; the lookup runs under their own ESI token (the
 * `esi-search.search_structures.v1` scope). A token that predates the scope
 * (403) surfaces a re-login prompt rather than a generic failure.
 */

export const runtime = 'nodejs';

export const GET = withApiMetrics('/api/structures/corp-search', async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.characterId) {
    return Response.json({ ok: false, error: 'You must be signed in.' }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get('q') ?? '';
  try {
    const data = await searchCorporations(query, BigInt(session.characterId));
    return Response.json({ ok: true, data });
  } catch (err) {
    if (
      err instanceof EsiTokenError ||
      (err instanceof EsiHttpError && (err.status === 401 || err.status === 403))
    ) {
      return Response.json(
        { ok: false, error: 'Sign out and back in to enable corporation search.' },
        { status: 400 },
      );
    }
    return Response.json(
      { ok: false, error: 'Corporation search is unavailable right now.' },
      { status: 502 },
    );
  }
});
