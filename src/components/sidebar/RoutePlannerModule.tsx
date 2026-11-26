'use client';

import React, {
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
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
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
import { addMapRouteFavouriteAction } from '@/app/(app)/actions/mapRouteFavourites';
import { subscribeExperimentalPanelAdd } from '@/lib/experimentalPanelActionBus';
import { setMapActiveRouteAction } from '@/app/(app)/actions/mapActiveRoute';
import { pushKspaceWaypointsForCharacter } from '@/lib/character/pushRouteWaypoints';
import { subscribeRouteDestinations } from '@/lib/map/routeDestinationBus';
import {
  readExperimentalExitOrigin,
  readExperimentalIncludeJumpBridge,
  resolveHomeFightRouteEnds,
  subscribeExperimentalRoutePrefs,
  writeExperimentalExitOrigin,
  writeExperimentalFightMapSystemId,
  writeExperimentalIncludeJumpBridge,
  type ExperimentalExitOrigin,
} from '@/lib/experimentalRoutePrefs';
import {
  JITA_SYSTEM_ID,
  pickPrimaryChainExit,
  stagingTaggedSystems,
  THERA_SYSTEM_ID,
  topChainExitsForCompare,
  TURNUR_SYSTEM_ID,
} from '@/lib/map/experimentalRouteExit';
import { summarizeRoutePlan } from '@/lib/map/experimentalRouteAnalysis';
import { RouteHopBreadcrumb } from '@/components/sidebar/RouteHopMarkers';
import type {
  MapConnectionEdge,
  MapSignature,
  MapSystemNode,
  RouteInstructionToken,
  RouteDestinationView,
  RoutePlan,
  RoutePrefs,
  RouteSafety,
  MapRouteFavouriteView,
  MapPresenceEntry,
  SystemIntelSummary,
  SystemSearchResult,
  SystemStatsSummary,
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
  onPlanHighlight,
  planHighlightSuppressed = false,
  onPlanHighlightEngaged,
  mapRouteFavourites,
  activeCharacterId,
  viewerCharacters = [],
  onActiveRouteSaved,
  onHopClick,
  stats = {},
  intel = {},
  presence = [],
  homeMapSystemId = null,
}: {
  mapId: string;
  selectedSystemId: number | null;
  homeMapSystemId?: string | null;
  initialPrefs: RoutePrefs;
  initialDestinations: RouteDestinationView[];
  systems: MapSystemNode[];
  connections: MapConnectionEdge[];
  signatures: MapSignature[];
  /** Experimental: highlight the first reachable plan on the map canvas. */
  onPlanHighlight?: (plan: RoutePlan | null) => void;
  /** Experimental: after Stop on Current Route, suppress auto-highlight until the user picks a plan again. */
  planHighlightSuppressed?: boolean;
  onPlanHighlightEngaged?: () => void;
  /** Experimental: pan/zoom + highlight an on-map hop.systemId (EVE id). */
  onHopClick?: (eveSystemId: number) => void;
  /** Experimental: per-map pinned favourites (personal + shared). */
  mapRouteFavourites?: MapRouteFavouriteView[];
  activeCharacterId?: number | null;
  /** Account characters available as route followers when setting an active route. */
  viewerCharacters?: { id: number; name: string }[];
  onActiveRouteSaved?: () => void;
  stats?: Record<number, SystemStatsSummary>;
  intel?: Record<number, SystemIntelSummary>;
  presence?: MapPresenceEntry[];
}) {
  const { activeCharSystemId, activeCharId } = useMapActiveChar();

  const [prefs, setPrefs] = useState<RoutePrefs>(initialPrefs);
  // `updatePrefs` is the only writer, so this ref tracks the latest prefs without
  // a render-phase functional updater (which can't host a transition).
  const prefsRef = useRef(initialPrefs);
  const [destinations, setDestinations] = useState<RouteDestinationView[]>(initialDestinations);
  const [manualSource, setManualSource] = useState<SystemSearchResult | null>(null);
  const [plans, setPlans] = useState<RoutePlan[]>([]);
  const [computing, setComputing] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<ReadonlySet<number>>(() => new Set());
  const [analysisDestId, setAnalysisDestId] = useState<number | null>(null);
  const [exitComparePlans, setExitComparePlans] = useState<
    { originSystemId: number; originName: string; plan: RoutePlan }[]
  >([]);
  const [exitCompareBusy, setExitCompareBusy] = useState(false);
  const [highlightedPlan, setHighlightedPlan] = useState<RoutePlan | null>(null);
  const [favourites, setFavourites] = useState<MapRouteFavouriteView[]>(
    () => mapRouteFavourites ?? [],
  );
  const [setRoutePlan, setSetRoutePlan] = useState<RoutePlan | null>(null);
  const [followerPick, setFollowerPick] = useState<ReadonlySet<number>>(() => new Set());
  const [, startPrefs] = useTransition();

  const routeSource = useSyncExternalStore(
    subscribeRouteSource,
    readRouteSource,
    serverRouteSource,
  );

  const experimentalRoutes = onPlanHighlight != null;

  const exitOrigin = useSyncExternalStore(
    subscribeExperimentalRoutePrefs,
    readExperimentalExitOrigin,
    () => 'chain' as ExperimentalExitOrigin,
  );

  const includeJumpBridge = useSyncExternalStore(
    subscribeExperimentalRoutePrefs,
    readExperimentalIncludeJumpBridge,
    () => true,
  );

  const setRouteSource = useCallback((v: RouteSource) => {
    writeRouteSource(v);
  }, []);

  const chainExit = useMemo(
    () => (experimentalRoutes ? pickPrimaryChainExit(systems, connections) : null),
    [experimentalRoutes, systems, connections],
  );

  const sourceSystemId =
    routeSource === 'character'
      ? (activeCharSystemId ?? manualSource?.id ?? null)
      : selectedSystemId;

  const exitCompareOrigins = useMemo(() => {
    if (!experimentalRoutes) return [];
    if (exitOrigin === 'selected') {
      if (selectedSystemId == null) return [];
      const row = systems.find((s) => s.systemId === selectedSystemId);
      return row ? [row] : [];
    }
    return topChainExitsForCompare(systems, connections, 3);
  }, [experimentalRoutes, exitOrigin, selectedSystemId, systems, connections]);

  const computePrefs = useMemo(
    (): RoutePrefs => ({
      ...prefs,
      includeJumpBridge: experimentalRoutes ? includeJumpBridge : prefs.includeJumpBridge,
    }),
    [prefs, includeJumpBridge, experimentalRoutes],
  );

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
  const prefsKey = useMemo(() => JSON.stringify(computePrefs), [computePrefs]);

  // All state writes happen inside the timer callback (not the effect body) to
  // honour the no-synchronous-setState-in-effect rule (same as AddSystemDialog).
  const computeSeq = useRef(0);
  const exitCompareSeq = useRef(0);
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
        prefs: computePrefs,
      });
      if (seq !== computeSeq.current) return;
      if (result.ok) {
        setPlans(result.data);
      } else {
        setPlans([]);
        toast.error('error' in result ? result.error : 'Could not compute routes.');
      }
      setComputing(false);
    }, noWork ? 0 : COMPUTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `connectionsKey`/`destKey`/`prefsKey`/`signaturesKey`/`tagsKey` stand in
    // for the array/object deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapId, sourceSystemId, destKey, prefsKey, connectionsKey, signaturesKey, tagsKey]);

  useEffect(() => {
    if (!onPlanHighlight) return;
    if (planHighlightSuppressed) {
      onPlanHighlight(null);
      return;
    }
    if (highlightedPlan?.reachable) {
      onPlanHighlight(highlightedPlan);
      return;
    }
    const first = plans.find((p) => p.reachable);
    onPlanHighlight(first ?? null);
  }, [plans, onPlanHighlight, highlightedPlan, planHighlightSuppressed]);

  const compareDestId = destinations[0]?.systemId ?? null;
  const shouldExitCompare =
    experimentalRoutes && compareDestId != null && exitCompareOrigins.length >= 2;

  useEffect(() => {
    if (!shouldExitCompare) {
      return;
    }
    const seq = ++exitCompareSeq.current;
    const timer = setTimeout(async () => {
      setExitCompareBusy(true);
      const rows: { originSystemId: number; originName: string; plan: RoutePlan }[] = [];
      for (const origin of exitCompareOrigins) {
        const result = await requestJson<
          { ok: true; data: RoutePlan[] } | { ok: false; error: string }
        >('POST', `/api/map/${mapId}/route-plan`, {
          sourceSystemId: origin.systemId,
          destinationSystemIds: [compareDestId],
          prefs: computePrefs,
        });
        if (seq !== exitCompareSeq.current) return;
        if (!result.ok) continue;
        const plan = result.data[0];
        if (plan) {
          rows.push({
            originSystemId: origin.systemId,
            originName: origin.alias?.trim() || origin.name,
            plan,
          });
        }
      }
      if (seq !== exitCompareSeq.current) return;
      rows.sort((a, b) => {
        const aj = a.plan.reachable ? a.plan.jumps : Number.POSITIVE_INFINITY;
        const bj = b.plan.reachable ? b.plan.jumps : Number.POSITIVE_INFINITY;
        return aj - bj || a.originName.localeCompare(b.originName);
      });
      setExitComparePlans(rows);
      setExitCompareBusy(false);
    }, COMPUTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    shouldExitCompare,
    compareDestId,
    exitCompareOrigins,
    mapId,
    computePrefs,
    prefsKey,
    connectionsKey,
    signaturesKey,
    tagsKey,
  ]);

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
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setDestinations((prev) =>
      prev.some((d) => d.systemId === result.data.systemId) ? prev : [...prev, result.data],
    );
  }, []);

  const addDestinationByEveId = useCallback(
    async (systemId: number, label: string) => {
      const result = await addRouteDestinationAction({ systemId, label });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDestinations((prev) =>
        prev.some((d) => d.systemId === result.data.systemId) ? prev : [...prev, result.data],
      );
      toast.success(`Destination: ${label}`);
    },
    [],
  );

  const addNearestHighsec = useCallback(async () => {
    if (sourceSystemId == null) {
      toast.error('Set a start system first.');
      return;
    }
    const result = await requestJson<
      { ok: true; data: { systemId: number } } | { ok: false; error: string }
    >('GET', `/api/map/${mapId}/route-shortcut?from=${sourceSystemId}&kind=nearest_highsec`);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await addDestinationByEveId(result.data.systemId, 'Nearest high-sec');
  }, [addDestinationByEveId, mapId, sourceSystemId]);

  const addStagingDestination = useCallback(async () => {
    const tagged = stagingTaggedSystems(systems);
    if (tagged.length === 0) {
      toast.error('No staging-tagged systems on this map.');
      return;
    }
    const pick = tagged[0]!;
    await addDestinationByEveId(pick.systemId, pick.alias?.trim() || pick.name);
  }, [addDestinationByEveId, systems]);

  const addHomeFightRoute = useCallback(async () => {
    const { home, fight } = resolveHomeFightRouteEnds(systems, homeMapSystemId);
    if (!home) {
      toast.error('Set a Home system on the map first.');
      return;
    }
    if (!fight) {
      toast.error('Tag a fight system (tag/alias “fight”) or pick one in route prefs.');
      return;
    }
    writeExperimentalFightMapSystemId(fight.id);
    await addDestinationByEveId(home.systemId, `Home · ${home.alias?.trim() || home.name}`);
    await addDestinationByEveId(fight.systemId, `Fight · ${fight.alias?.trim() || fight.name}`);
  }, [addDestinationByEveId, systems, homeMapSystemId]);

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

  useEffect(
    () =>
      subscribeExperimentalPanelAdd('route', () => {
        document.getElementById('route-add-destination-input')?.focus();
      }),
    [],
  );

  const planBySystem = useMemo(() => {
    const m = new Map<number, RoutePlan>();
    for (const p of plans) m.set(p.destinationSystemId, p);
    return m;
  }, [plans]);

  const pickFavourite = useCallback(
    async (fav: MapRouteFavouriteView) => {
      const fake: SystemSearchResult = {
        id: fav.systemId,
        name: fav.name,
        security: fav.security,
        securityStatus: null,
        regionName: '',
        constellationName: '',
      };
      await addDestination(fake);
    },
    [addDestination],
  );

  const pinFavourite = useCallback(
    async (system: SystemSearchResult) => {
      const result = await addMapRouteFavouriteAction({
        mapId,
        systemId: system.id,
        label: system.name,
        shared: false,
      });
      if (!result.ok) return;
      setFavourites((prev) => {
        const rest = prev.filter((f) => f.systemId !== result.data.systemId);
        return [...rest, result.data];
      });
      toast.success('Pinned to map favourites');
    },
    [mapId],
  );

  const beginSetActiveRoute = useCallback(
    (plan: RoutePlan) => {
      const charId = activeCharacterId ?? activeCharId;
      if (!charId) {
        toast.error('Pick an active character first.');
        return;
      }
      const defaultFollowers =
        viewerCharacters.length > 0
          ? viewerCharacters.map((c) => c.id)
          : [charId];
      setFollowerPick(new Set(defaultFollowers));
      setSetRoutePlan(plan);
    },
    [activeCharacterId, activeCharId, viewerCharacters],
  );

  const commitSetActiveRoute = useCallback(async () => {
    const plan = setRoutePlan;
    if (!plan) return;
    const charId = activeCharacterId ?? activeCharId;
    if (!charId) {
      toast.error('Pick an active character first.');
      return;
    }
    const followerCharacterIds = [...followerPick];
    if (!followerCharacterIds.includes(charId)) {
      followerCharacterIds.unshift(charId);
    }
    if (followerCharacterIds.length === 0) {
      toast.error('Select at least one follower.');
      return;
    }
    const push = await pushKspaceWaypointsForCharacter(charId, plan.hops);
    if (!push.ok) {
      toast.error(push.error);
      return;
    }
    const saved = await setMapActiveRouteAction({
      mapId,
      primaryCharacterId: charId,
      destinationSystemId: plan.destinationSystemId,
      plan,
      followerCharacterIds,
    });
    if (!saved.ok) {
      toast.error(saved.error);
      return;
    }
    setSetRoutePlan(null);
    toast.success(`Active route set (${push.pushed} waypoint${push.pushed === 1 ? '' : 's'} pushed)`);
    onActiveRouteSaved?.();
  }, [
    activeCharacterId,
    activeCharId,
    followerPick,
    mapId,
    onActiveRouteSaved,
    setRoutePlan,
  ]);

  const toggleFollowerPick = useCallback((id: number) => {
    setFollowerPick((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

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

        {experimentalRoutes ? (
          <div className="flex flex-col gap-2 rounded-md border border-dashed border-border/50 p-2">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Experimental exits
            </span>
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-muted-foreground">Exit origin</span>
              <ToggleChip
                active={exitOrigin === 'chain'}
                onClick={() => writeExperimentalExitOrigin('chain')}
              >
                Chain exit
                {chainExit ? ` (${chainExit.alias?.trim() || chainExit.name})` : ''}
              </ToggleChip>
              <ToggleChip
                active={exitOrigin === 'selected'}
                onClick={() => writeExperimentalExitOrigin('selected')}
              >
                Selected
              </ToggleChip>
            </div>
            <ToggleChip
              active={includeJumpBridge}
              onClick={() => writeExperimentalIncludeJumpBridge(!includeJumpBridge)}
            >
              Jump bridges
            </ToggleChip>
            <div className="flex flex-wrap gap-1">
              <ShortcutChip onClick={() => void addNearestHighsec()}>Nearest HS</ShortcutChip>
              <ShortcutChip
                onClick={() => void addDestinationByEveId(JITA_SYSTEM_ID, 'Jita')}
              >
                Jita
              </ShortcutChip>
              <ShortcutChip onClick={() => void addStagingDestination()}>Staging</ShortcutChip>
              <ShortcutChip onClick={() => void addHomeFightRoute()}>Home → fight</ShortcutChip>
              <ShortcutChip
                onClick={() => void addDestinationByEveId(THERA_SYSTEM_ID, 'Thera')}
              >
                Thera
              </ShortcutChip>
              <ShortcutChip
                onClick={() => void addDestinationByEveId(TURNUR_SYSTEM_ID, 'Turnur')}
              >
                Turnur
              </ShortcutChip>
            </div>
            {shouldExitCompare ? (
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground">Exit compare → {destinations[0]?.name}</span>
                {exitCompareBusy ? (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" /> Comparing…
                  </span>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {exitComparePlans.map((row) => (
                      <li key={row.originSystemId}>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-2 rounded border border-border/40 px-2 py-1 text-left hover:bg-muted/40"
                          onClick={() => {
                            if (row.plan.reachable) {
                              setHighlightedPlan(row.plan);
                              onPlanHighlightEngaged?.();
                            }
                          }}
                        >
                          <span className="truncate">{row.originName}</span>
                          <span className="shrink-0 font-mono text-muted-foreground">
                            {row.plan.reachable ? `${row.plan.jumps}j` : '—'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        {favourites.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {favourites.map((f) => (
              <button
                key={f.id}
                type="button"
                className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] hover:bg-muted/40"
                title={f.shared ? 'Shared favourite' : 'Personal favourite'}
                onClick={() => void pickFavourite(f)}
              >
                {f.label ?? f.name}
                {f.shared ? ' · shared' : ''}
              </button>
            ))}
          </div>
        ) : null}

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
                onHopClick={onHopClick}
                onSetActive={
                  onPlanHighlight && planBySystem.get(dest.systemId)?.reachable
                    ? () => {
                        const plan = planBySystem.get(dest.systemId);
                        if (plan?.reachable) beginSetActiveRoute(plan);
                      }
                    : undefined
                }
                experimentalRoutes={experimentalRoutes}
                analysisOpen={analysisDestId === dest.systemId}
                onToggleAnalysis={() =>
                  setAnalysisDestId((prev) => (prev === dest.systemId ? null : dest.systemId))
                }
                analysisLines={
                  experimentalRoutes && analysisDestId === dest.systemId && planBySystem.get(dest.systemId)
                    ? summarizeRoutePlan({
                        plan: planBySystem.get(dest.systemId)!,
                        connections,
                        stats,
                        presence,
                        intel,
                      })
                    : undefined
                }
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
          {onPlanHighlight ? (
            <SystemSearchField
              mapId={mapId}
              placeholder="Pin favourite…"
              icon="search"
              clearOnPick
              onPick={(s) => void pinFavourite(s)}
            />
          ) : null}
        </div>
      </CardContent>
      <Dialog open={setRoutePlan != null} onOpenChange={(open) => !open && setSetRoutePlan(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Set active route</DialogTitle>
            <DialogDescription>
              Push k-space waypoints for the active character and track followers on this device.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-1">
            {(viewerCharacters.length > 0 ? viewerCharacters : followerPick.size > 0
              ? [...followerPick].map((id) => ({ id, name: `Character ${id}` }))
              : []
            ).map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={followerPick.has(c.id)}
                  onChange={() => toggleFollowerPick(c.id)}
                />
                {c.name}
              </label>
            ))}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => setSetRoutePlan(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void commitSetActiveRoute()}>
              Set route
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function RouteBreadcrumb({
  plan,
  computing,
  hasSource,
  onHopClick,
}: {
  plan: RoutePlan | undefined;
  computing: boolean;
  hasSource: boolean;
  onHopClick?: (eveSystemId: number) => void;
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
  return <RouteHopBreadcrumb hops={plan.hops} onHopClick={onHopClick} />;
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
  onSetActive,
  onHopClick,
  experimentalRoutes,
  analysisOpen,
  onToggleAnalysis,
  analysisLines,
}: {
  dest: RouteDestinationView;
  plan: RoutePlan | undefined;
  computing: boolean;
  sourceSystemId: number | null;
  expanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onSetActive?: () => void;
  onHopClick?: (eveSystemId: number) => void;
  experimentalRoutes?: boolean;
  analysisOpen?: boolean;
  onToggleAnalysis?: () => void;
  analysisLines?: { label: string; value: string }[];
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
              {experimentalRoutes && plan?.reachable && onToggleAnalysis ? (
                <button
                  type="button"
                  onClick={onToggleAnalysis}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                  aria-expanded={analysisOpen}
                >
                  Analysis
                </button>
              ) : null}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {onSetActive ? (
            <button
              type="button"
              onClick={onSetActive}
              disabled={!plan?.reachable || stale}
              className="text-[10px] text-primary hover:underline disabled:opacity-40"
            >
              Set route
            </button>
          ) : null}
          <button
            type="button"
            onClick={onRemove}
            className="text-muted-foreground hover:text-destructive"
            aria-label={`Remove ${dest.name}`}
          >
            <X className="size-3.5" />
          </button>
        </span>
      </div>
      <RouteBreadcrumb
        plan={plan}
        computing={computing}
        hasSource={sourceSystemId != null}
        onHopClick={onHopClick}
      />
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
      {analysisOpen && analysisLines && analysisLines.length > 0 ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded bg-muted/20 p-2 text-[10px]">
          {analysisLines.map((line) => (
            <React.Fragment key={line.label}>
              <dt className="text-muted-foreground">{line.label}</dt>
              <dd className="text-foreground">{line.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      ) : null}
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

function ShortcutChip({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-border/50 px-1.5 py-0.5 text-[10px] hover:bg-muted/50"
    >
      {children}
    </button>
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
        id={placeholder.startsWith('Add destination') ? 'route-add-destination-input' : undefined}
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
