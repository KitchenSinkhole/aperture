import 'server-only';
import { type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { canManageMap } from '@/lib/auth/rights';
import {
  auditActorSummary,
  listAuditActors,
  queryAuditEvents,
  type AuditQueryParams,
} from '@/lib/map/audit';
import { MAP_EVENT_KINDS, type MapEventKind } from '@/lib/realtime/protocol';
import { requireMapView } from '../../utils';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * GET /api/map/[mapId]/audit
 * Keyset-paginated commit feed for the in-map audit console. Read-only.
 *
 * Access: `canManageMap` only (private-map owner, owning-corp Director,
 * owning-alliance executor-corp Director, or admin). A plain member with view
 * access must NOT read the audit feed, so this layers `canManageMap` on top of
 * `requireMapView` (which scopes the map and returns 404 to avoid leaking
 * existence).
 *
 * Query params: `cursor`, `limit`, `characterId` (numeric or `none`),
 * `kinds` (comma-separated `MapEventKind`s), `from`/`to` (ISO timestamps), `q`.
 *
 * The first page (no `cursor`) also carries `actors` (the full actor list for
 * the filter dropdown), so the browser is self-contained inside its dialog.
 */

export const runtime = 'nodejs';

const KIND_SET: ReadonlySet<string> = new Set(MAP_EVENT_KINDS);

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export const GET = withApiMetrics('/api/map/:mapId/audit', async function GET(_request: NextRequest, { params }: { params: Promise<{ mapId: string }> }) {
  const session = await getSession();
  const { mapId: rawMapId } = await params;

  const guard = await requireMapView(rawMapId, session);
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }
  if (!(await canManageMap(guard.characterId, guard.mapId))) {
    return Response.json({ ok: false, error: 'Forbidden.' }, { status: 403 });
  }

  const sp = _request.nextUrl.searchParams;

  const query: AuditQueryParams = { mapId: guard.mapId };

  const rawCharacter = sp.get('characterId');
  if (rawCharacter === 'none') {
    query.characterId = 'none';
  } else if (rawCharacter && /^\d+$/.test(rawCharacter)) {
    query.characterId = BigInt(rawCharacter);
  }

  const rawKinds = sp.get('kinds');
  if (rawKinds) {
    const kinds = rawKinds.split(',').filter((k): k is MapEventKind => KIND_SET.has(k));
    if (kinds.length > 0) query.kinds = kinds;
  }

  const from = parseDate(sp.get('from'));
  if (from) query.from = from;
  const to = parseDate(sp.get('to'));
  if (to) query.to = to;

  const q = sp.get('q');
  if (q) query.q = q;

  const cursor = sp.get('cursor');
  if (cursor) query.cursor = cursor;

  const rawLimit = sp.get('limit');
  if (rawLimit && /^\d+$/.test(rawLimit)) query.limit = Number(rawLimit);

  const page = await queryAuditEvents(query);

  // On the first page of a single-actor drill-down, attach the actor's aggregate
  // for the header. Omitted on "load more" (cursor present) and for the all-actors
  // view. Ignores `kinds`/`q` so the breakdown always covers the full window.
  const actorSummary =
    query.characterId !== undefined && !query.cursor
      ? await auditActorSummary(query.mapId, query.characterId, query.from, query.to)
      : null;

  // The actor list backs the filter dropdown — only needed on the first page
  // (no cursor), where the browser builds the dropdown. Omitted on "load more".
  const actors = query.cursor ? undefined : await listAuditActors(query.mapId);

  return Response.json({ ok: true, data: { ...page, actorSummary, actors } });
});
