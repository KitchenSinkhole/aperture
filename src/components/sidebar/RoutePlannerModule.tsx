'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Copy, Loader2, Plus, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Tooltip } from '@base-ui/react/tooltip';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { systemSecurityColor } from '@/components/map/styling';
import {
  formatRouteInstructions,
  routeSegmentTokens,
  routeSpaceKind,
  segmentRoute,
} from '@/lib/map/routeSegments';
import { searchSystemsOnServer } from '@/lib/map/client';
import { requestJson } from '@/lib/http/fetchJson';
import { useMapActiveChar } from '@/components/map/MapActiveCharContext';
import {
  addRouteDestinationAction,
  removeRouteDestinationAction,
  setRoutePrefsAction,
} from '@/app/(app)/actions/routes';
import { subscribeRouteDestinations } from '@/lib/map/routeDestinationBus';
import type {
  MapConnectionEdge,
  MapSignature,
  MapSystemNode,
  RouteInstructionToken,
  RouteDestinationView,
  RouteHop,
  RoutePlan,
  RoutePrefs,
  RouteSafety,
  SystemSearchResult,
  WhJumpMass,
} from '@/types';

// routes-module. Configurable multi-hop route planner: shortest path from a
// picked character's current system to each saved destination, over K-space
// stargates + the live wormhole chain (+ optional EVE-Scout). Replaces the old
// read-only hub-distance Route module. Settings/destinations persist per-account
// via Server Actions; routes are computed by the `route-plan` API and re-fetched
// when the source, settings, destinations, or the chain change.

const SAFETY_LABELS: Record<RouteSafety, string> = {
  shortest: 'Shortest',
  safer: 'Safer',
  less_safe: 'Less safe',
};
const SHIP_NONE = '__any__';
const SHIP_LABELS: Record<WhJumpMass, string> = {
  s: 'Frigate (S)',
  m: 'Medium (M)',
  l: 'Large (L)',
  xl: 'X-Large (XL)',
};
const COMPUTE_DEBOUNCE_MS = 300;
const SEARCH_DEBOUNCE_MS = 200;
const ROUTE_SOURCE_KEY = 'aperture:routes:source';

type RouteSource = 'character' | 'system';

function readRouteSource(): RouteSource {
  try {
    const v = localStorage.getItem(ROUTE_SOURCE_KEY);
    return v === 'system' ? 'system' : 'character';
  } catch {
    return 'character';
  }
}

// Server render (and the first hydration pass) always sees the default, so the
// markup matches; `useSyncExternalStore` swaps in the persisted value right
// after hydration — SSR-safe without reading localStorage during render.
function serverRouteSource(): RouteSource {
  return 'character';
}

const routeSourceListeners = new Set<() => void>();

function subscribeRouteSource(onChange: () => void): () => void {
  routeSourceListeners.add(onChange);
  return () => routeSourceListeners.delete(onChange);
}

function writeRouteSource(v: RouteSource): void {
  try { localStorage.setItem(ROUTE_SOURCE_KEY, v); } catch {}
  for (const cb of routeSourceListeners) cb();
}

export function RoutePlannerModule({
  mapId,
  selectedSystemId,
  initialPrefs,
  initialDestinations,
  systems,
  connections,
  signatures,
}: {
  mapId: string;
  selectedSystemId: number | null;
  initialPrefs: RoutePrefs;
  initialDestinations: RouteDestinationView[];
  systems: MapSystemNode[];
  connections: MapConnectionEdge[];
  signatures: MapSignature[];
}) {
  const { activeCharSystemId } = useMapActiveChar();

  const [prefs, setPrefs] = useState<RoutePrefs>(initialPrefs);
  // `updatePrefs` is the only writer, so this ref tracks the latest prefs without
  // a render-phase functional updater (which can't host a transition).
  const prefsRef = useRef(initialPrefs);
  const [destinations, setDestinations] = useState<RouteDestinationView[]>(initialDestinations);
  const [manualSource, setManualSource] = useState<SystemSearchResult | null>(null);
  const [plans, setPlans] = useState<RoutePlan[]>([]);
  const [computing, setComputing] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<ReadonlySet<number>>(() => new Set());
  const [, startPrefs] = useTransition();

  const routeSource = useSyncExternalStore(
    subscribeRouteSource,
    readRouteSource,
    serverRouteSource,
  );

  const setRouteSource = useCallback((v: RouteSource) => {
    writeRouteSource(v);
  }, []);

  const sourceSystemId =
    routeSource === 'character'
      ? (activeCharSystemId ?? manualSource?.id ?? null)
      : selectedSystemId;

  // Recompute key: any change to source / prefs / destinations / the chain.
  const connectionsKey = useMemo(
    () =>
      connections
        .map((c) => `${c.id}:${c.scope}:${c.massStatus}:${c.eolStage}:${c.jumpMassClass ?? ''}`)
        .join('|'),
    [connections],
  );
  // Only connection-bound sigs matter: they are what `RouteHop.viaSigId` names,
  // so scanning or correcting one has to re-plan. Sorted because the array order
  // is not stable across events.
  const signaturesKey = useMemo(
    () =>
      signatures
        .filter((s) => s.mapConnectionId != null)
        .map((s) => `${s.mapConnectionId}:${s.mapSystemId}:${s.sigId}`)
        .sort()
        .join('|'),
    [signatures],
  );
  // `RouteHop.tag` is baked into the server plan and is what every instruction
  // line calls a system, so a rename has to re-plan. Untagged systems are left
  // out, which still moves the key when a tag is cleared.
  const tagsKey = useMemo(
    () =>
      systems
        .filter((s) => s.tag)
        .map((s) => `${s.systemId}:${s.tag}`)
        .sort()
        .join('|'),
    [systems],
  );
  const destKey = useMemo(() => destinations.map((d) => d.systemId).join(','), [destinations]);
  const prefsKey = useMemo(() => JSON.stringify(prefs), [prefs]);

  // All state writes happen inside the timer callback (not the effect body) to
  // honour the no-synchronous-setState-in-effect rule (same as AddSystemDialog).
  const computeSeq = useRef(0);
  useEffect(() => {
    const seq = ++computeSeq.current;
    const noWork = sourceSystemId == null || destinations.length === 0;
    const timer = setTimeout(async () => {
      if (noWork) {
        if (seq !== computeSeq.current) return;
        setPlans([]);
        setComputing(false);
        return;
      }
      setComputing(true);
      const result = await requestJson<
        { ok: true; data: RoutePlan[] } | { ok: false; error: string }
      >('POST', `/api/map/${mapId}/route-plan`, {
        sourceSystemId,
        destinationSystemIds: destinations.map((d) => d.systemId),
        prefs,
      });
      if (seq !== computeSeq.current) return;
      setPlans(result.ok ? result.data : []);
      setComputing(false);
    }, noWork ? 0 : COMPUTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `connectionsKey`/`destKey`/`prefsKey`/`signaturesKey`/`tagsKey` stand in
    // for the array/object deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapId, sourceSystemId, destKey, prefsKey, connectionsKey, signaturesKey, tagsKey]);

  const updatePrefs = useCallback(
    (patch: Partial<RoutePrefs>) => {
      const next = { ...prefsRef.current, ...patch };
      prefsRef.current = next;
      setPrefs(next);
      startPrefs(() => {
        void setRoutePrefsAction(next);
      });
    },
    [startPrefs],
  );

  const addDestination = useCallback(async (system: SystemSearchResult) => {
    const result = await addRouteDestinationAction({ systemId: system.id });
    if (!result.ok) return;
    setDestinations((prev) =>
      prev.some((d) => d.systemId === result.data.systemId) ? prev : [...prev, result.data],
    );
  }, []);

  const removeDestination = useCallback(async (id: number) => {
    setDestinations((prev) => prev.filter((d) => d.id !== id));
    await removeRouteDestinationAction(id);
  }, []);

  const toggleSteps = useCallback((id: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  // Fold destinations added elsewhere (the map context-menu "Add to routes" item
  // persists + broadcasts them) so they appear without a reload.
  useEffect(
    () =>
      subscribeRouteDestinations((dest) => {
        setDestinations((prev) =>
          prev.some((d) => d.systemId === dest.systemId) ? prev : [...prev, dest],
        );
      }),
    [],
  );

  const planBySystem = useMemo(() => {
    const m = new Map<number, RoutePlan>();
    for (const p of plans) m.set(p.destinationSystemId, p);
    return m;
  }, [plans]);

  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-3 text-xs">
        {/* Source + route settings. `@container` lets the three selects share one
            row once the card is wide enough, and stack when it's narrow. */}
        <div className="@container flex flex-col gap-2">
          <div className="grid grid-cols-1 gap-2 @md:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">From</span>
              <div className="flex gap-1">
                <ToggleChip
                  active={routeSource === 'character'}
                  onClick={() => setRouteSource('character')}
                >
                  Active character
                </ToggleChip>
                <ToggleChip
                  active={routeSource === 'system'}
                  onClick={() => setRouteSource('system')}
                >
                  Selected system
                </ToggleChip>
              </div>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">Safety</span>
              <Select<RouteSafety>
                value={prefs.safety}
                onValueChange={(v) => v && updatePrefs({ safety: v })}
                items={SAFETY_LABELS}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SAFETY_LABELS) as RouteSafety[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {SAFETY_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">Min ship</span>
              <Select<string>
                value={prefs.minShipClass ?? SHIP_NONE}
                onValueChange={(v) =>
                  v && updatePrefs({ minShipClass: v === SHIP_NONE ? null : (v as WhJumpMass) })
                }
                items={{ [SHIP_NONE]: 'Any', ...SHIP_LABELS }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SHIP_NONE}>Any</SelectItem>
                  {(Object.keys(SHIP_LABELS) as WhJumpMass[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {SHIP_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>

          {/* Fallback prompts when the chosen source has no system */}
          {routeSource === 'character' && activeCharSystemId === null && (
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">
                No tracked character is located. Pick a start system:
              </span>
              <SystemSearchField
                mapId={mapId}
                placeholder={manualSource ? manualSource.name : 'Start system…'}
                onPick={(s) => setManualSource(s)}
              />
            </div>
          )}
          {routeSource === 'system' && selectedSystemId === null && (
            <span className="text-muted-foreground">Select a system on the map.</span>
          )}
        </div>

        {/* Avoid toggles */}
        <div className="flex flex-wrap gap-1 rounded-md bg-muted/30 p-2">
            <ToggleChip
              active={prefs.avoidReduced}
              onClick={() => updatePrefs({ avoidReduced: !prefs.avoidReduced })}
            >
              Avoid reduced
            </ToggleChip>
            <ToggleChip
              active={prefs.avoidCritical}
              onClick={() => updatePrefs({ avoidCritical: !prefs.avoidCritical })}
            >
              Avoid critical
            </ToggleChip>
            <ToggleChip
              active={prefs.avoidEol}
              onClick={() => updatePrefs({ avoidEol: !prefs.avoidEol })}
            >
              Avoid EOL
            </ToggleChip>
            <ToggleChip
              active={prefs.includeEveScout}
              onClick={() => updatePrefs({ includeEveScout: !prefs.includeEveScout })}
            >
              EVE-Scout
            </ToggleChip>
        </div>

        {/* Destinations + routes */}
        <div className="flex flex-col gap-2">
          {destinations.length === 0 ? (
            <p className="text-muted-foreground">Add a destination to plan a route.</p>
          ) : (
            destinations.map((dest) => (
              <DestinationRow
                key={dest.id}
                dest={dest}
                plan={planBySystem.get(dest.systemId)}
                computing={computing}
                sourceSystemId={sourceSystemId}
                expanded={expandedSteps.has(dest.id)}
                onToggle={() => toggleSteps(dest.id)}
                onRemove={() => removeDestination(dest.id)}
              />
            ))
          )}

          <SystemSearchField
            mapId={mapId}
            placeholder="Add destination…"
            icon="plus"
            clearOnPick
            onPick={addDestination}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function RouteBreadcrumb({
  plan,
  computing,
  hasSource,
}: {
  plan: RoutePlan | undefined;
  computing: boolean;
  hasSource: boolean;
}) {
  if (!hasSource) return <span className="text-muted-foreground">Set a start system.</span>;
  if (!plan) {
    return computing ? (
      <span className="flex items-center gap-1 text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Computing…
      </span>
    ) : null;
  }
  if (!plan.reachable) return <span className="text-destructive">No route found.</span>;
  return (
    <div className="flex flex-wrap items-center gap-[3px]">
      {plan.hops.map((hop, i) => (
        <HopSquare key={`${hop.systemId}-${i}`} hop={hop} />
      ))}
    </div>
  );
}

/**
 * One saved destination: name + jump count + step controls on the header row,
 * the hop breadcrumb below it, and the expanded instruction list under that.
 */
function DestinationRow({
  dest,
  plan,
  computing,
  sourceSystemId,
  expanded,
  onToggle,
  onRemove,
}: {
  dest: RouteDestinationView;
  plan: RoutePlan | undefined;
  computing: boolean;
  sourceSystemId: number | null;
  expanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const segments = useMemo(() => (plan ? segmentRoute(plan) : []), [plan]);

  // A plan outlives the source it was computed from — the recompute is debounced
  // and round-trips — so a pilot who has just jumped would otherwise copy
  // directions starting from the system they left.
  const stale = computing || (plan != null && plan.hops[0]?.systemId !== sourceSystemId);

  const copy = () => {
    void navigator.clipboard.writeText(formatRouteInstructions(segments)).then(
      () => toast.success('Directions copied'),
      () => toast.error('Could not copy directions'),
    );
  };

  return (
    <div className="flex flex-col gap-1 rounded-md border border-border/60 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-medium">
          <span className="flex items-center gap-1.5">
            <span style={{ color: systemSecurityColor(dest.security, dest.securityStatus) }}>
              {dest.name}
            </span>
            {plan?.reachable ? (
              <span className="font-mono text-muted-foreground">{plan.jumps}j</span>
            ) : null}
          </span>
          {segments.length > 0 && (
            <span className="flex items-center gap-2 font-normal">
              <button
                type="button"
                onClick={onToggle}
                aria-expanded={expanded}
                className="flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
              >
                <ChevronRight
                  className={`size-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
                />
                {segments.length} {segments.length === 1 ? 'step' : 'steps'}
              </button>
              <button
                type="button"
                onClick={copy}
                disabled={stale}
                title={stale ? 'Recomputing from the current system…' : undefined}
                aria-label={`Copy directions to ${dest.name}`}
                className="flex items-center gap-0.5 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted-foreground"
              >
                <Copy className="size-3" />
                Copy
              </button>
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 text-muted-foreground hover:text-destructive"
          aria-label={`Remove ${dest.name}`}
        >
          <X className="size-3.5" />
        </button>
      </div>
      <RouteBreadcrumb plan={plan} computing={computing} hasSource={sourceSystemId != null} />
      {expanded && segments.length > 0 && (
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-xs leading-snug text-muted-foreground marker:font-mono">
          {segments.map((seg) => (
            <li key={seg.fromHopIndex}>
              {routeSegmentTokens(seg).map((tok, i) => (
                <InstructionToken key={i} token={tok} />
              ))}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** One instruction fragment: systems tinted as on the map, sig codes in mono. */
function InstructionToken({ token }: { token: RouteInstructionToken }) {
  if (token.kind === 'system') {
    return (
      <span style={{ color: systemSecurityColor(token.point.security, token.point.securityStatus) }}>
        {token.text}
      </span>
    );
  }
  if (token.kind === 'sig') return <span className="font-mono">{token.text}</span>;
  return <>{token.text}</>;
}

const VIA_LABELS: Record<RouteHop['via'], string> = {
  origin: 'Start',
  gate: 'via gate',
  wh: 'via wormhole',
  jumpbridge: 'via jumpbridge',
  eve_scout: 'via EVE-Scout',
};

/**
 * One route hop as a small security-coloured marker; system name on hover.
 * Wormhole (J-space) systems render as circles, K-space systems as squares.
 */
function HopSquare({ hop }: { hop: RouteHop }) {
  const isWormhole = routeSpaceKind(hop.security, hop.name) === 'jspace';
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={<span />}
        className={`size-3 shrink-0 ${isWormhole ? 'rounded-full' : ''}`}
        style={{ backgroundColor: systemSecurityColor(hop.security, hop.securityStatus) }}
        aria-label={hop.name}
      />
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={4} side="top" align="center">
          <Tooltip.Popup className="z-50 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md">
            {hop.tag && <span className="mr-1 font-mono text-muted-foreground">[{hop.tag}]</span>}
            <span style={{ color: systemSecurityColor(hop.security, hop.securityStatus) }}>{hop.name}</span>
            <span className="ml-1 text-muted-foreground">{VIA_LABELS[hop.via]}</span>
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function ToggleChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
        active
          ? 'border-primary/40 bg-primary/15 text-foreground'
          : 'border-border bg-transparent text-muted-foreground hover:bg-muted/40'
      }`}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

/** Inline debounced solar-system typeahead (reuses the map's system-search endpoint). */
function SystemSearchField({
  mapId,
  placeholder,
  onPick,
  icon = 'search',
  clearOnPick = false,
}: {
  mapId: string;
  placeholder: string;
  onPick: (system: SystemSearchResult) => void;
  icon?: 'search' | 'plus';
  clearOnPick?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SystemSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trimmed = query.trim();
    const token = ++seq.current;
    const timer = setTimeout(async () => {
      const data =
        trimmed.length < 2
          ? []
          : await searchSystemsOnServer({ mapId, query: trimmed }).then((r) =>
              r.ok ? r.data : [],
            );
      if (token !== seq.current) return;
      setResults(data);
      setLoading(false);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, mapId]);

  const Icon = icon === 'plus' ? Plus : Search;
  return (
    <div ref={wrapperRef} className="relative">
      <Icon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      {loading && (
        <Loader2 className="absolute top-1/2 right-2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
      )}
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setLoading(e.target.value.trim().length >= 2);
        }}
        placeholder={placeholder}
        className="h-8 pl-7 text-xs"
      />
      {/* Portalled out of the Card (which is `overflow-hidden`) so the dropdown
          isn't clipped by the card edge; anchored to the input via its rect. */}
      <SearchResults
        anchorRef={wrapperRef}
        results={results}
        onPick={(s) => {
          onPick(s);
          if (clearOnPick) setQuery('');
          setResults([]);
        }}
      />
    </div>
  );
}

/** Floating result list, portalled to `document.body` and pinned under the input. */
function SearchResults({
  anchorRef,
  results,
  onPick,
}: {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  results: SystemSearchResult[];
  onPick: (system: SystemSearchResult) => void;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (results.length === 0) return;
    const measure = () => {
      const el = anchorRef.current;
      if (el) setRect(el.getBoundingClientRect());
    };
    measure();
    // Re-pin on scroll (capture: catches the sidebar's own scroll container) and resize.
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [anchorRef, results.length]);

  if (results.length === 0 || rect == null) return null;

  return createPortal(
    <ul
      className="fixed z-50 max-h-56 overflow-auto rounded-md border bg-popover p-0.5 shadow-md"
      style={{ top: rect.bottom + 4, left: rect.left, width: rect.width }}
    >
      {results.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            onClick={() => onPick(s)}
            className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted/60"
          >
            <span className="truncate">{s.name}</span>
            <span className="shrink-0 font-mono" style={{ color: systemSecurityColor(s.security, s.securityStatus) }}>
              {s.security ?? '—'}
            </span>
          </button>
        </li>
      ))}
    </ul>,
    document.body,
  );
}
