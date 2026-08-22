import 'server-only';
import { type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { resolveIntelViewer } from '@/lib/structures/guard';
import { searchSystemNotes } from '@/lib/system-notes/read';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * GET /api/system-notes/search?q=<text> — note search for the browser:
 * substring match on note body or system name, newest first, capped
 * server-side. Results are filtered to the rows the caller's scope admits —
 * inside the query, before the cap — so a capped page contains only admitted
 * rows and never leaks another organisation's journal. Queries under 2
 * characters return `[]` without touching the DB.
 */

export const runtime = 'nodejs';

const SEARCH_MIN_CHARS = 2;
const SEARCH_MAX_CHARS = 100;

export const GET = withApiMetrics('/api/system-notes/search', async function GET(
  request: NextRequest,
) {
  const session = await getSession();
  if (!session?.characterId) {
    return Response.json({ ok: false, error: 'You must be signed in.' }, { status: 401 });
  }
  const viewer = await resolveIntelViewer(BigInt(session.characterId));
  if (!viewer) {
    return Response.json({ ok: false, error: 'You must be signed in.' }, { status: 401 });
  }

  const q = (request.nextUrl.searchParams.get('q') ?? '').trim().slice(0, SEARCH_MAX_CHARS);
  if (q.length < SEARCH_MIN_CHARS) {
    return Response.json({ ok: true, data: [] });
  }

  const data = await searchSystemNotes(q, viewer);
  return Response.json({ ok: true, data });
});
