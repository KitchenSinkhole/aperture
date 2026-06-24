'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { ccpImageUrl } from '@/lib/integrations/links';
import type {
  ActorSummary,
  AuditActor,
  AuditEventCategory,
  AuditEventRow,
  MapEventKind,
} from '@/types';

/**
 * MapAuditBrowser — the interactive surface of the in-map audit console. Fetches
 * the keyset-paginated commit feed from `/api/map/[mapId]/audit`, with actor /
 * category / date / search filters, a per-actor drill-down summary, and
 * "load more" paging. Self-contained: the actor list for the filter dropdown
 * rides the first-page response, so the component needs only `mapId` and lives
 * inside `MapAuditDialog`.
 */

// UI-local knowledge of the kind vocabulary, typed against `MapEventKind` so a
// schema change surfaces here as a type error. Avoids importing the server-side
// protocol/schema runtime into the client bundle.
const CATEGORY_KINDS: Record<AuditEventCategory, MapEventKind[]> = {
  system: ['system.added', 'system.removed', 'system.updated'],
  connection: ['connection.create', 'connection.update', 'connection.delete'],
  signature: ['signature.create', 'signature.update', 'signature.delete'],
  note: ['note.created', 'note.updated', 'note.deleted'],
  map: ['map.create', 'map.update', 'map.delete', 'map.restore', 'map.purge'],
};
const CATEGORIES: AuditEventCategory[] = ['system', 'connection', 'signature', 'note', 'map'];
const ALL_KINDS: MapEventKind[] = CATEGORIES.flatMap((c) => CATEGORY_KINDS[c]);
const DESTRUCTIVE_KINDS: MapEventKind[] = [
  'system.removed',
  'connection.delete',
  'signature.delete',
  'note.deleted',
  'map.delete',
  'map.purge',
];

const CATEGORY_LABEL: Record<AuditEventCategory, string> = {
  system: 'System',
  connection: 'Connection',
  signature: 'Signature',
  note: 'Note',
  map: 'Map',
};

const ABS_FMT = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

// Cadence of the auto-refresh poll. A hard-coded constant, not a runtime knob.
const AUTO_REFRESH_MS = 3000;

function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return ABS_FMT.format(new Date(iso));
}

/** A specific actor, the automation bucket, or every actor. */
type ActorFilter = 'all' | 'none' | string;

interface AuditApiData {
  rows: AuditEventRow[];
  nextCursor: string | null;
  actorSummary: ActorSummary | null;
  /** Present only on the first page (no cursor) — backs the actor dropdown. */
  actors?: AuditActor[];
}

function computeKinds(
  categories: Set<AuditEventCategory>,
  destructiveOnly: boolean,
): MapEventKind[] | null {
  // No narrowing at all → omit the param entirely.
  if (categories.size === 0 && !destructiveOnly) return null;
  let kinds = categories.size > 0 ? [...categories].flatMap((c) => CATEGORY_KINDS[c]) : ALL_KINDS;
  if (destructiveOnly) kinds = kinds.filter((k) => DESTRUCTIVE_KINDS.includes(k));
  return kinds;
}

function localDateToIso(value: string, endOfDay: boolean): string | null {
  if (!value) return null;
  const d = new Date(`${value}T${endOfDay ? '23:59:59' : '00:00:00'}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function MapAuditBrowser({ mapId }: { mapId: string }) {
  const [actors, setActors] = useState<AuditActor[]>([]);
  const [actor, setActor] = useState<ActorFilter>('all');
  const [categories, setCategories] = useState<Set<AuditEventCategory>>(new Set());
  const [destructiveOnly, setDestructiveOnly] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');

  const [rows, setRows] = useState<AuditEventRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [actorSummary, setActorSummary] = useState<ActorSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Manual/auto refresh: bumping the nonce re-runs the first-page effect.
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput), 250);
    return () => clearTimeout(t);
  }, [qInput]);

  const categoriesKey = [...categories].sort().join(',');

  const buildUrl = useCallback(
    (cursor: string | null): string => {
      const params = new URLSearchParams();
      if (actor === 'none') params.set('characterId', 'none');
      else if (actor !== 'all') params.set('characterId', actor);
      const kinds = computeKinds(categories, destructiveOnly);
      if (kinds) params.set('kinds', kinds.join(','));
      const fromIso = localDateToIso(fromDate, false);
      if (fromIso) params.set('from', fromIso);
      const toIso = localDateToIso(toDate, true);
      if (toIso) params.set('to', toIso);
      if (q.trim()) params.set('q', q.trim());
      if (cursor) params.set('cursor', cursor);
      params.set('limit', '50');
      return `/api/map/${mapId}/audit?${params.toString()}`;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- categoriesKey stands in for the Set identity
    [mapId, actor, categoriesKey, destructiveOnly, fromDate, toDate, q],
  );

  // Refetch the first page whenever a filter changes.
  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function loadFirstPage() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(buildUrl(null), { signal: controller.signal });
        const json: { ok: boolean; data?: AuditApiData; error?: string } = await res.json();
        if (!active) return;
        if (!json.ok || !json.data) {
          setError(json.error ?? 'Failed to load audit log.');
          return;
        }
        setRows(json.data.rows);
        setNextCursor(json.data.nextCursor);
        setActorSummary(json.data.actorSummary);
        if (json.data.actors) setActors(json.data.actors);
      } catch (err) {
        if (active && !(err instanceof DOMException && err.name === 'AbortError')) {
          setError('Failed to load audit log.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadFirstPage();
    return () => {
      active = false;
      controller.abort();
    };
  }, [buildUrl, refreshNonce]);

  // Auto-refresh: poll the first page on a fixed cadence while enabled.
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => setRefreshNonce((n) => n + 1), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh]);

  // "Load more" — append the next keyset page. Event-driven (not an effect), so
  // it reads the current `nextCursor` and appends rather than replacing.
  const loadMore = async () => {
    if (!nextCursor) return;
    const cursor = nextCursor;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildUrl(cursor));
      const json: { ok: boolean; data?: AuditApiData; error?: string } = await res.json();
      if (!json.ok || !json.data) {
        setError(json.error ?? 'Failed to load audit log.');
        return;
      }
      setRows((prev) => [...prev, ...json.data!.rows]);
      setNextCursor(json.data.nextCursor);
    } catch {
      setError('Failed to load audit log.');
    } finally {
      setLoading(false);
    }
  };

  const selectedActor = useMemo(
    () => (actor === 'all' ? null : actors.find((a) => (a.characterId ?? 'none') === actor) ?? null),
    [actor, actors],
  );

  const toggleCategory = (c: AuditEventCategory) => {
    setCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  const clearFilters = () => {
    setActor('all');
    setCategories(new Set());
    setDestructiveOnly(false);
    setFromDate('');
    setToDate('');
    setQInput('');
  };

  const setLast24h = () => {
    const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
    setFromDate(d.toISOString().slice(0, 10));
    setToDate('');
  };

  const hasFilters =
    actor !== 'all' ||
    categories.size > 0 ||
    destructiveOnly ||
    fromDate !== '' ||
    toDate !== '' ||
    q.trim() !== '';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
        <select
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          className="h-8 rounded-md border border-border bg-background px-2 text-sm"
          aria-label="Filter by actor"
        >
          <option value="all">All actors</option>
          {actors.map((a) => (
            <option key={a.characterId ?? 'none'} value={a.characterId ?? 'none'}>
              {a.name} ({a.eventCount})
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          {CATEGORIES.map((c) => {
            const active = categories.has(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggleCategory(c)}
                className={`h-8 rounded-md border px-2 text-xs font-medium ${
                  active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                {CATEGORY_LABEL[c]}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setDestructiveOnly((v) => !v)}
          className={`inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs font-medium ${
            destructiveOnly
              ? 'border-destructive bg-destructive/10 text-destructive'
              : 'border-border text-muted-foreground hover:bg-muted'
          }`}
        >
          <ShieldAlert className="size-3.5" />
          Deletions only
        </button>

        <button
          type="button"
          onClick={setLast24h}
          className="h-8 rounded-md border border-border px-2 text-xs font-medium text-muted-foreground hover:bg-muted"
        >
          Last 24h
        </button>

        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          From
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          To
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
          />
        </label>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search sig, system, actor…"
            className="h-8 w-52 rounded-md border border-border bg-background pl-7 pr-2 text-sm"
          />
        </div>

        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="h-8 rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setRefreshNonce((n) => n + 1)}
            disabled={loading}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
            title="Refresh now"
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setAutoRefresh((v) => !v)}
            className={`inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs font-medium ${
              autoRefresh
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:bg-muted'
            }`}
            title={`Auto-refresh every ${AUTO_REFRESH_MS / 1000}s`}
            aria-pressed={autoRefresh}
          >
            <RefreshCw className={`size-3.5 ${autoRefresh ? 'animate-spin' : ''}`} />
            Auto
          </button>
        </div>
      </div>

      {/* Actor drill-down summary */}
      {selectedActor && actorSummary && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-border bg-muted/30 px-4 py-2 text-sm">
          <span className="font-medium">{selectedActor.name}</span>
          <span className="text-muted-foreground">
            {actorSummary.total} {actorSummary.total === 1 ? 'commit' : 'commits'}
          </span>
          {CATEGORIES.map((c) => (
            <span key={c} className="text-xs text-muted-foreground">
              {CATEGORY_LABEL[c]}: <span className="tabular-nums">{actorSummary.byCategory[c]}</span>
            </span>
          ))}
          <span
            className={`inline-flex items-center gap-1 text-xs font-medium ${
              actorSummary.destructive > 0 ? 'text-destructive' : 'text-muted-foreground'
            }`}
          >
            <ShieldAlert className="size-3.5" />
            {actorSummary.destructive} destructive
          </span>
        </div>
      )}

      {error && (
        <div className="shrink-0 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Feed table */}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground backdrop-blur-sm">
            <tr>
              <th className="px-3 py-2 font-medium">When</th>
              <th className="px-3 py-2 font-medium">Actor</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-border align-middle">
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground" title={ABS_FMT.format(new Date(row.occurredAt))}>
                  {relativeTime(row.occurredAt)}
                </td>
                <td className="px-3 py-2">
                  {row.characterId ? (
                    <button
                      type="button"
                      onClick={() => setActor(row.characterId!)}
                      className="flex items-center gap-2 hover:underline"
                      title="Filter to this actor"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- static EVE CDN avatar */}
                      <img
                        src={ccpImageUrl('characters', BigInt(row.characterId), 'portrait', 32)}
                        alt=""
                        width={20}
                        height={20}
                        className="size-5 rounded-full bg-muted"
                      />
                      <span className="truncate">{row.characterName}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setActor('none')}
                      className="text-muted-foreground hover:underline"
                    >
                      System
                    </button>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-xs ${
                      row.destructive
                        ? 'bg-destructive/10 text-destructive'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {row.kind}
                  </span>
                </td>
                <td className="px-3 py-2">{row.summary}</td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No commits match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex shrink-0 items-center justify-center">
        {loading ? (
          <span className="py-2 text-xs text-muted-foreground">Loading…</span>
        ) : nextCursor ? (
          <button
            type="button"
            onClick={() => void loadMore()}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Load more
          </button>
        ) : rows.length > 0 ? (
          <span className="py-2 text-xs text-muted-foreground">End of history.</span>
        ) : null}
      </div>
    </div>
  );
}
