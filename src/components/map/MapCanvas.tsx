'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Background,
  ConnectionMode,
  Controls,
  ReactFlow,
  SelectionMode,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Layout, ResponsiveLayouts } from 'react-grid-layout';
import type {
  Breakpoint,
  MapContextMenuTarget,
  MapEventPayload,
  MapLayoutConfig,
  MapSettings,
  MapSignature,
  MapSystemNode,
  MapViewData,
  PanelId,
  RouteDestinationView,
  RoutePrefs,
  SignatureIndicatorPrefs,
  SigSearchFilters,
  StructureIntel,
} from '@/types';
import type { SystemStatsSummary } from '@/lib/map/stats';
import type { SystemIntelSummary } from '@/lib/map/intel';
import { applyEvent } from '@/lib/map/applyEvent';
import {
  GRID_SIZE,
  findOpenPosition,
  overlaps,
  snapToGrid as snapPointToGrid,
  type Point,
} from '@/lib/map/placement';
import {
  addSystemOnServer,
  createConnectionOnServer,
  createSignatureOnServer,
  deleteConnectionOnServer,
  deleteDisconnectedOnServer,
  deleteSignatureOnServer,
  deleteSubchainOnServer,
  restoreConnectionOnServer,
  fetchMapSnapshot,
  fetchSystemData,
  fetchSystemSignatures,
  pingSystemOnServer,
  removeSystemOnServer,
  updateConnectionOnServer,
  updateSignatureOnServer,
  updateSystemOnServer,
  addNoteOnServer,
  updateNoteOnServer,
  deleteNoteOnServer,
  type CreateSignatureBody,
  type UpdateConnectionBody,
  type UpdateNoteBody,
  type UpdateSignatureBody,
  type UpdateSystemBody,
} from '@/lib/map/client';
import { computeDisconnected, computeSubchain } from '@/lib/map/subchainGraph';
import {
  createStructureOnServer,
  deleteStructureOnServer,
  updateStructureOnServer,
} from '@/lib/structures/client';
import { mapUpdateLoadSchema, type Envelope } from '@/lib/realtime/protocol';
import { useMapSubscription, useRealtimeEvents, useReconnectResync } from '@/lib/realtime/useRealtime';
import { RoutePlannerModule } from '@/components/sidebar/RoutePlannerModule';
import { KillStatsModule } from '@/components/sidebar/KillStatsModule';
import { SystemGraphModule } from '@/components/sidebar/SystemGraphModule';
import { SystemKillboardModule } from '@/components/sidebar/SystemKillboardModule';
import { TagsModule } from '@/components/sidebar/TagsModule';
import { TheraModule } from '@/components/sidebar/TheraModule';
import { IntelModule } from '@/components/sidebar/IntelModule';
import { StructureModule } from '@/components/sidebar/StructureModule';
import type { StructureFormValues } from '@/components/sidebar/StructureFormDialog';
import { InspectorModule, type SelectionRef } from '@/components/sidebar/InspectorModule';
import {
  SignatureModule,
  SignatureModuleHeaderActions,
} from '@/components/sidebar/SignatureModule';
import { Info, LayoutDashboard, Plus, RotateCcw, ScrollText, Search, Settings, Trash2, User } from 'lucide-react';
import { Tooltip } from '@base-ui/react/tooltip';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/menu';
import { MapInfoDialog } from '@/components/dialogs/MapInfoDialog';
import { PilotRosterButton } from './PilotRosterButton';
import { SystemOverlayButton } from './SystemOverlayButton';
import { MapSettingsDialog } from '@/components/dialogs/MapSettingsDialog';
import { MapAuditDialog } from '@/components/map/manage/MapAuditDialog';
import { SignatureSearchDialog } from '@/components/dialogs/SignatureSearchDialog';
import { AddSystemDialog } from './AddSystemDialog';
import { ConnectionEdge, type ConnectionEdgeData } from './ConnectionEdge';
import { MapPresenceProvider } from './MapPresenceContext';
import { MapActiveCharProvider, useMapActiveChar } from './MapActiveCharContext';
import { MapSignatureIndicatorProvider } from './MapSignatureIndicatorContext';
import { SignaturePasteHotkey } from './SignaturePasteHotkey';
import { TransitSignaturePrompt } from './TransitSignaturePrompt';
import { MapTravelProvider, TravelBridge } from './MapTravelContext';
import { MapUnderglowProvider } from './MapUnderglowContext';
import { MapUnderglowBridge } from './MapUnderglowBridge';
import { SystemNode, type SystemNodeData } from './SystemNode';
import { MapNoteNode, type MapNoteNodeData } from './MapNoteNode';
import { MapContextMenu } from './MapContextMenu';
import { SubchainDeletePrompt } from './SubchainDeletePrompt';
import { RestoreConnectionPrompt } from './RestoreConnectionPrompt';
import { MapLayoutGrid } from './layout/MapLayoutGrid';
import { MapPanel } from './layout/MapPanel';
import { DEFAULT_MAP_LAYOUT, PANELS, ensurePanelsPlaced } from '@/lib/map/layout/panels';
import { setMapLayoutAction } from '@/app/(app)/actions/account';

// Debounce window for persisting layout edits (drag/resize/hide) to the server.
const LAYOUT_SAVE_DEBOUNCE_MS = 600;

// Compact character selector for the map toolbar. Must render inside
// MapActiveCharProvider (which is inside MapPresenceProvider).
function ActiveCharSelector() {
  const { activeCharId, locatedChars, setPickedCharId } = useMapActiveChar();

  if (locatedChars.length === 0) {
    return (
      <Tooltip.Root>
        <Tooltip.Trigger
          render={<span />}
          className="inline-flex h-8 cursor-default items-center gap-1 rounded-md px-2 opacity-50"
        >
          <User className="size-3.5 shrink-0" />
          <span className="text-muted-foreground text-sm">No characters</span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner sideOffset={4} side="bottom" align="center">
            <Tooltip.Popup className="z-50 max-w-[16rem] rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md">
              No characters are currently tracked on this map. Character tracking requires an
              in-game session with ESI location scope.
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    );
  }

  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={<span className="inline-flex" />}>
        <Select<string>
          value={String(activeCharId ?? '')}
          onValueChange={(v) => setPickedCharId(v ? Number(v) : null)}
          items={Object.fromEntries(locatedChars.map((c) => [String(c.id), c.name]))}
        >
          <SelectTrigger className="h-8 w-auto px-2 text-sm gap-1">
            <User className="size-3.5 shrink-0" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {locatedChars.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={4} side="bottom" align="center">
          <Tooltip.Popup className="z-50 max-w-[18rem] rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md">
            Active character — controls map focus, route planning, and signature highlighting
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

// Union two breakpoints' layout arrays by item `i` (incoming wins). RGL only
// reports geometry for panels currently rendered, so a hidden panel's slot (and
// any panel not yet placed) is preserved from the previous state rather than
// dropped from the breakpoint on the next change.
function mergeLayouts(
  prev: Record<Breakpoint, Layout>,
  incoming: ResponsiveLayouts<Breakpoint>,
): Record<Breakpoint, Layout> {
  const next = { ...prev };
  for (const bp of Object.keys(incoming) as Breakpoint[]) {
    const incomingBp = incoming[bp];
    if (!incomingBp) continue;
    const incomingIds = new Set(incomingBp.map((item) => item.i));
    const kept = prev[bp].filter((item) => !incomingIds.has(item.i));
    next[bp] = [...incomingBp, ...kept];
  }
  return next;
}

const nodeTypes = { system: SystemNode, note: MapNoteNode };
const edgeTypes = { connection: ConnectionEdge };

// xyflow node ids must be unique, but `ap_map_system.id` and `ap_map_note.id` are
// independent identity sequences and so collide numerically. Namespace note nodes
// (`note:<id>`) in xyflow; their real `ap_map_note.id` stays on `data.id`.
type CanvasNode = Node<SystemNodeData> | Node<MapNoteNodeData>;
const noteNodeId = (noteId: string) => `note:${noteId}`;

/** A pending "also delete the subchain?" offer raised by a deleted wormhole sig. */
type SubchainSigOffer = {
  headId: string;
  anchorId: string;
  headName: string;
  count: number;
};

// A re-confirmed wormhole sig whose remembered connection is currently dormant
// (absent from the view) → an offer to restore it. Keyed on the dormant
// connection id; `targetName` names the far system for the prompt.
type RestoreConnOffer = {
  connId: string;
  targetName: string;
};

export function MapCanvas({
  data,
  stats: initialStats,
  intel: initialIntel,
  structures: initialStructures,
  settings,
  canManage,
  travelAnimation,
  signatureIndicators,
  viewerCharacterIds,
  viewerCharacters,
  mainCharacterId,
  routePrefs,
  routeDestinations,
  mapLayout,
}: {
  data: MapViewData;
  stats: Record<number, SystemStatsSummary>;
  intel: Record<number, SystemIntelSummary>;
  structures: Record<number, StructureIntel[]>;
  settings: MapSettings;
  /** Whether the viewer can manage this map (derived `canManageMap`) — reveals settings/webhooks/audit. */
  canManage: boolean;
  travelAnimation: boolean;
  /** Viewer's resolved stale/unscanned indicator prefs (threshold + toggles). */
  signatureIndicators: SignatureIndicatorPrefs;
  /** Viewer's account character ids — matched against presence for the CTRL+V fast-paste location check. */
  viewerCharacterIds: number[];
  /** Viewer's active characters (id + name) for the route planner's source picker. */
  viewerCharacters: { id: number; name: string }[];
  /** The account's main character id (route planner's default source), or null. */
  mainCharacterId: number | null;
  /** Per-account route-planner settings (routes-module). */
  routePrefs: RoutePrefs;
  /** The account's saved route destinations (routes-module). */
  routeDestinations: RouteDestinationView[];
  /**
   * Saved per-account dashboard layout (map-layout-builder), or `null` to use
   * `DEFAULT_MAP_LAYOUT`.
   */
  mapLayout?: MapLayoutConfig | null;
}) {
  const [selected, setSelected] = useState<SelectionRef | null>(null);
  // The multi-select set; `selected` (above) remains the primary anchor that
  // drives the inspector and sidebar modules. Invariant: when
  // `selected?.kind === 'system'`, this set contains `selected.id`. Always
  // replaced with a fresh Set (never mutated) — the render-time sync block
  // detects changes by reference equality.
  const [selectedSystemIds, setSelectedSystemIds] = useState<Set<string>>(() => new Set());
  // Right-click context-menu target (independent of selection — right-click does
  // not change `selected`/`selectedSystemIds`). `null` ⇒ no menu open.
  const [contextMenu, setContextMenu] = useState<MapContextMenuTarget | null>(null);
  // Pending delete-subchain confirmation. The doomed systems are also highlighted
  // via `selectedSystemIds` while this is open. `null` ⇒ no prompt.
  const [subchainPreview, setSubchainPreview] = useState<{
    headId: string;
    anchorId: string | null;
    headName: string;
    count: number;
  } | null>(null);
  // Queue of "also delete the subchain?" prompts, offered after a wormhole sig
  // with a populated "Leads to" is deleted — one per such sig. The row trash
  // icon enqueues a single entry; a lazy-delete paste can enqueue several at
  // once. `[0]` is the active prompt; an empty queue ⇒ no prompt.
  const [subchainSigPrompts, setSubchainSigPrompts] = useState<SubchainSigOffer[]>([]);
  const [restoreConnPrompts, setRestoreConnPrompts] = useState<RestoreConnOffer[]>([]);
  // Pending delete-disconnected confirmation. The doomed systems (everything cut
  // off from the Home) are highlighted via `selectedSystemIds` while open.
  const [disconnectedPreview, setDisconnectedPreview] = useState<{ count: number } | null>(null);
  const [mapInfoOpen, setMapInfoOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [addSystemOpen, setAddSystemOpen] = useState(false);
  const [sigSearchOpen, setSigSearchOpen] = useState(false);
  const [sigSearchFilters, setSigSearchFilters] = useState<SigSearchFilters>({
    name: '',
    groupKey: null,
    maxAgeHours: null,
    securityClasses: [],
  });
  const [flashSigId, setFlashSigId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One-shot "Lazy delete" arm for the CTRL+V fast paste: when on, the next
  // direct scanner paste also removes missing sigs, then disarms itself.
  const [lazyDeleteSigs, setLazyDeleteSigs] = useState(false);
  const [viewData, setViewData] = useState<MapViewData>(data);
  // Captured via ReactFlow's onInit so the manual-add flow can place new nodes
  // at the current viewport centre rather than (0,0).
  const flowInstance = useRef<ReactFlowInstance<
    CanvasNode,
    Edge<ConnectionEdgeData>
  > | null>(null);
  const flowWrapperRef = useRef<HTMLDivElement>(null);
  // Client-space point set by the pane "Add system" action; consumed by the next
  // `onAddSystem` so the added node lands where the user right-clicked rather than
  // at the selection/viewport-centre default. Cleared once read.
  const pendingAddPoint = useRef<{ x: number; y: number } | null>(null);
  // True only while a drag-box selection is in progress. `onSelectionChange`
  // fires for our own click-driven selection echoes too; without this gate the
  // reconciler would fight the click handlers and loop. Box drag is the only
  // selection source we must adopt from xyflow.
  const boxSelecting = useRef(false);
  // Read-side per-system data (intel / activity stats / structure intel) is
  // server-rendered for the systems present at page load, then held as state so
  // systems added live can be backfilled (see the effect below) without a reload.
  // Structure intel is also updated in place by our own CRUD callbacks.
  const [intel, setIntel] = useState(initialIntel);
  const [stats, setStats] = useState(initialStats);
  const [structures, setStructures] = useState(initialStructures);

  // EVE solar-system ids whose read-side data has been loaded or is in flight.
  // Seeded from the load-time intel (one entry per initially-rendered system).
  const requestedSystemData = useRef<Set<number>>(
    new Set(Object.keys(initialIntel).map(Number)),
  );
  // Backfill systems added after the initial render (paste, tracked-pilot jump,
  // manual add): one batched fetch per new id-set, merged into state so their
  // sov/FW/incursion decorators and sidebar modules fill in without a reload.
  // Additive only — an id already requested is never refetched (a stale snapshot
  // matches the existing load-time model); a failed fetch is retried on the next
  // system change by un-marking its ids.
  useEffect(() => {
    const missing = viewData.systems
      .map((s) => s.systemId)
      .filter((id) => !requestedSystemData.current.has(id));
    if (missing.length === 0) return;
    for (const id of missing) requestedSystemData.current.add(id);
    fetchSystemData({ mapId: data.map.id, systemIds: missing }).then((result) => {
      if (!result.ok) {
        for (const id of missing) requestedSystemData.current.delete(id);
        return;
      }
      setIntel((prev) => ({ ...prev, ...result.data.intel }));
      setStats((prev) => ({ ...prev, ...result.data.stats }));
      setStructures((prev) => ({ ...prev, ...result.data.structures }));
    });
  }, [viewData.systems, data.map.id]);

  const [nodes, setNodes] = useState<CanvasNode[]>(() => [
    ...data.systems.map((s) => ({
      id: s.id,
      type: 'system' as const,
      position: { x: s.positionX, y: s.positionY },
      data: {
        ...s,
        isHome: s.id === data.map.homeMapSystemId,
        inFactionWarfare: intel[s.systemId]?.factionWar != null,
        hasIncursion: intel[s.systemId]?.incursion != null,
      },
      selected: false,
      draggable: !s.locked,
    })),
    ...data.notes.map((n) => ({
      id: noteNodeId(n.id),
      type: 'note' as const,
      position: { x: n.positionX, y: n.positionY },
      data: { ...n },
      selected: false,
      draggable: !n.locked,
    })),
  ]);
  const appliedEventIds = useRef<Set<number>>(new Set());

  // Signatures no longer ride the `system.added` event (that breached the 8 KB
  // pg_notify ceiling). On every system.added we refetch the system's sigs and
  // upsert them into the view, so a re-added system's survivors converge on all
  // tabs without a reload. Keyed on the *event*, not a viewData diff: re-add
  // reuses the same ap_map_system.id (soft delete), so a diff-and-dedupe effect
  // (like the read-side backfill above) would never refire.
  const sigHydrateInFlight = useRef<Set<string>>(new Set());
  const hydrateSignatures = useCallback(
    (mapSystemId: string) => {
      if (sigHydrateInFlight.current.has(mapSystemId)) return;
      sigHydrateInFlight.current.add(mapSystemId);
      void fetchSystemSignatures({ mapId: data.map.id, mapSystemId })
        .then((result) => {
          if (!result.ok) return;
          setViewData((prev) => {
            // Upsert-by-id (race-tolerant): a signature.create arriving during the
            // fetch is never clobbered; the baseline for a (re)added system is
            // empty (system.removed pruned / brand-new), so upsert == replace here.
            const next = [...prev.signatures];
            for (const sig of result.data) {
              const idx = next.findIndex((s) => s.id === sig.id);
              if (idx >= 0) next[idx] = sig;
              else next.push(sig);
            }
            return { ...prev, signatures: next };
          });
        })
        .finally(() => sigHydrateInFlight.current.delete(mapSystemId));
    },
    [data.map.id],
  );

  // Fire hydration for every system.added in a batch of just-applied payloads.
  // Called from each fold site *outside* the setViewData updater (no side effects
  // inside a state reducer).
  const hydrateAddedSystems = useCallback(
    (payloads: MapEventPayload[]) => {
      for (const p of payloads) if (p.kind === 'system.added') hydrateSignatures(p.id);
    },
    [hydrateSignatures],
  );

  const [initialViewport] = useState<Viewport | null>(() => {
    try {
      const raw = localStorage.getItem(`aperture:map:${data.map.id}:viewport`);
      return raw ? (JSON.parse(raw) as Viewport) : null;
    } catch {
      return null;
    }
  });

  // ---- Free-form dashboard layout (map-layout-builder) -------------------
  // Seeded from the saved per-account layout; `null` ⇒ the default arrangement.
  // `ensurePanelsPlaced` auto-places any registered panel missing from a saved
  // layout (a panel that shipped after the user last saved) — forward-compat,
  // no data migration. A no-op for `DEFAULT_MAP_LAYOUT` (already complete).
  const [layout, setLayout] = useState<MapLayoutConfig>(() =>
    ensurePanelsPlaced(mapLayout ?? DEFAULT_MAP_LAYOUT),
  );
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // RGL fires `onLayoutChange` once on mount with its normalized layout; that
  // first call updates local state but must not persist (no spurious write per
  // map open). Subsequent (user-driven) changes save.
  const firstLayoutChange = useRef(true);

  const saveLayout = useCallback((config: MapLayoutConfig) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      // Fire-and-forget: a layout-preference write failing is non-critical.
      void setMapLayoutAction(config);
    }, LAYOUT_SAVE_DEBOUNCE_MS);
  }, []);

  // Flush nothing but cancel a pending debounce on unmount.
  useEffect(() => () => clearTimeout(saveTimer.current ?? undefined), []);
  useEffect(() => () => clearTimeout(flashTimer.current ?? undefined), []);

  const handleLayoutChange = useCallback(
    (_current: Layout, all: ResponsiveLayouts<Breakpoint>) => {
      setLayout((prev) => {
        const next: MapLayoutConfig = { ...prev, layouts: mergeLayouts(prev.layouts, all) };
        if (!firstLayoutChange.current) saveLayout(next);
        firstLayoutChange.current = false;
        return next;
      });
    },
    [saveLayout],
  );

  const handleHide = useCallback(
    (id: PanelId) => {
      setLayout((prev) => {
        if (prev.hidden.includes(id)) return prev;
        const next: MapLayoutConfig = { ...prev, hidden: [...prev.hidden, id] };
        saveLayout(next);
        return next;
      });
    },
    [saveLayout],
  );

  // Panels-menu checkbox: flip a panel between hidden and visible. Re-showing a
  // panel returns it to its preserved slot — `mergeLayouts` keeps a hidden
  // panel's geometry, so the grid replaces it where it was, not at the bottom.
  const handleToggleVisible = useCallback(
    (id: PanelId) => {
      setLayout((prev) => {
        const hidden = prev.hidden.includes(id)
          ? prev.hidden.filter((h) => h !== id)
          : [...prev.hidden, id];
        const next: MapLayoutConfig = { ...prev, hidden };
        saveLayout(next);
        return next;
      });
    },
    [saveLayout],
  );

  // Reset to the shipped arrangement. Clone so later immutable updates can never
  // mutate the shared `DEFAULT_MAP_LAYOUT` constant.
  const handleResetLayout = useCallback(() => {
    const next = structuredClone(DEFAULT_MAP_LAYOUT);
    setLayout(next);
    saveLayout(next);
  }, [saveLayout]);

  const handleNavigateToSig = useCallback((systemId: string, sigId: string) => {
    setSigSearchOpen(false);
    setSelected({ kind: 'system', id: systemId });
    setSelectedSystemIds(new Set([systemId]));
    flowInstance.current?.fitView({ nodes: [{ id: systemId }], padding: 0.5, duration: 400 });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlashSigId(sigId);
    flashTimer.current = setTimeout(() => setFlashSigId(null), 3000);
  }, []);

  useMapSubscription(Number(data.map.id));

  // ---- Realtime apply (with dedupe of our own optimistic echoes) ----------
  // Every envelope is delivered exactly once via the listener registry, so a
  // same-tick burst (e.g. a wormhole jump's system.added + connection.create +
  // characterUpdate) applies all of them in order — no coalescing drop.
  useRealtimeEvents(
    useCallback((envelope: Envelope) => {
      if (envelope.task !== 'mapUpdate') return;
      const loadResult = mapUpdateLoadSchema.safeParse(envelope.load);
      if (!loadResult.success || !loadResult.data.data) return;
      const payload = loadResult.data.data;
      if (appliedEventIds.current.has(payload.eventId)) return;
      appliedEventIds.current.add(payload.eventId);
      setViewData((prev) => applyEvent(prev, payload));
      hydrateAddedSystems([payload]);
    }, [hydrateAddedSystems]),
  );

  // ---- On-error resync failsafe ------------------------------------------
  //
  // A rollback can't fix every drift — e.g. an orphaned signature whose DB row
  // was cascade-deleted with its connection. When a mutation fails we refetch
  // the authoritative snapshot and reset the view. Guarded by an in-flight ref
  // so a burst of failures collapses into a single refetch; the dedupe set is
  // cleared because the fresh snapshot is the new baseline (any racing echo
  // re-applies idempotently via applyEvent).
  const resyncInFlight = useRef(false);
  const resync = useCallback(async () => {
    if (resyncInFlight.current) return;
    resyncInFlight.current = true;
    try {
      const result = await fetchMapSnapshot(data.map.id);
      if (result.ok) {
        appliedEventIds.current.clear();
        setViewData(result.data);
      }
    } finally {
      resyncInFlight.current = false;
    }
  }, [data.map.id]);

  // On a socket reconnect (open after a degraded/closed gap), the SharedWorker
  // resumes only NEW events — anything committed during the disconnect is lost.
  // Refetch the authoritative snapshot so the canvas converges to DB truth. The
  // initial mount-open does not fire (page-load snapshot is already fresh).
  useReconnectResync(resync);

  // ---- Optimistic-apply helpers (PATCH/DELETE) ---------------------------
  //
  // For PATCH/DELETE we apply locally first, snapshot for rollback, and dedupe
  // the realtime echo by its returned eventId. POST helpers (system add /
  // connection create / signature create) await the server payload and apply
  // through the normal path.
  const runOptimistic = useCallback(
    async (
      optimistic: MapEventPayload,
      run: () => Promise<
        { ok: true; data: MapEventPayload; eventId: number } | { ok: false; error: string }
      >,
    ) => {
      let snapshot: MapViewData | null = null;
      setViewData((prev) => {
        snapshot = prev;
        return applyEvent(prev, optimistic);
      });
      const result = await run();
      if (result.ok) {
        appliedEventIds.current.add(result.eventId);
      } else if (snapshot) {
        // Immediate rollback for responsiveness; resync reconciles deeper drift.
        setViewData(snapshot);
        void resync();
      }
    },
    [resync],
  );

  const awaitServer = useCallback(
    async (
      run: () => Promise<
        { ok: true; data: MapEventPayload; eventId: number } | { ok: false; error: string }
      >,
    ) => {
      const result = await run();
      if (!result.ok) {
        void resync();
        return;
      }
      appliedEventIds.current.add(result.eventId);
      setViewData((prev) => applyEvent(prev, result.data));
      hydrateAddedSystems([result.data]);
    },
    [resync, hydrateAddedSystems],
  );

  // Apply N event payloads in commit order and register each eventId in the
  // dedupe set — the bulk equivalent of `awaitServer`. Used by signature paste,
  // import, Thera sync, subchain delete, and manual add (system + gate links).
  const onBulkPaste = useCallback((payloads: MapEventPayload[]) => {
    if (payloads.length === 0) return;
    for (const p of payloads) appliedEventIds.current.add(p.eventId);
    setViewData((prev) => payloads.reduce(applyEvent, prev));
    hydrateAddedSystems(payloads);
  }, [hydrateAddedSystems]);

  // ---- xyflow → server callbacks -----------------------------------------
  const mapId = viewData.map.id;

  const onNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  // Commit the post-drag positions of every selected system. xyflow drags all
  // selected nodes in unison (same delta, formation preserved), writing their
  // live positions into `nodes` via onNodesChange; we read those back, snap
  // each, and PATCH it. The collision nudge runs only against *non-selected*
  // systems so an intra-group overlap never deforms the group. Unchanged
  // positions are skipped.
  const commitGroupMove = useCallback(() => {
    // Read live positions from xyflow's store (authoritative + synchronous at
    // dragStop) rather than the React `nodes` state, which can lag a frame.
    const live = flowInstance.current?.getNodes() ?? [];
    const occupiedOthers: Point[] = viewData.systems
      .filter((s) => !selectedSystemIds.has(s.id))
      .map((s) => ({ x: s.positionX, y: s.positionY }));
    for (const id of selectedSystemIds) {
      const node = live.find((n) => n.id === id);
      const existing = viewData.systems.find((s) => s.id === id);
      if (!node || !existing) continue;
      const snapped = snapPointToGrid(node.position);
      const final = occupiedOthers.some((o) => overlaps(snapped, o))
        ? findOpenPosition(snapped, occupiedOthers)
        : snapped;
      if (existing.positionX === final.x && existing.positionY === final.y) continue;
      const patch: UpdateSystemBody = { positionX: final.x, positionY: final.y };
      runOptimistic(
        { kind: 'system.updated', eventId: 0, id, positionX: final.x, positionY: final.y },
        () => updateSystemOnServer({ mapId, mapSystemId: id, patch }),
      );
    }
  }, [mapId, viewData.systems, selectedSystemIds, runOptimistic]);

  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent | unknown, node: Node) => {
      // Notes drag independently and may overlap anything — snap, then commit the
      // position optimistically (no collision nudge). Notes aren't tracked in
      // `selectedSystemIds`, but xyflow still group-drags every node it selected
      // (e.g. a box-select over several notes) in unison, so commit each selected
      // note — not just the grabbed one, or the others snap back on release. Read
      // the live store (authoritative at dragStop); the grabbed node is always
      // included even if its `selected` flag hasn't landed yet. The real
      // `ap_map_note.id` lives on `data.id` (the xyflow id is namespaced).
      if (node.type === 'note') {
        const live = flowInstance.current?.getNodes() ?? [];
        const draggedNotes = live.filter(
          (n) => n.type === 'note' && (n.selected || n.id === node.id),
        );
        for (const noteNode of draggedNotes) {
          const noteId = (noteNode.data as MapNoteNodeData).id;
          const note = viewData.notes.find((n) => n.id === noteId);
          if (!note) continue;
          const snapped = snapPointToGrid(noteNode.position);
          if (note.positionX === snapped.x && note.positionY === snapped.y) continue;
          runOptimistic(
            {
              kind: 'note.updated',
              eventId: 0,
              id: noteId,
              title: note.title,
              positionX: snapped.x,
              positionY: snapped.y,
              // Carry the current attribution so the optimistic apply doesn't blank
              // "last edited by"; the authoritative echo overwrites it with the actor.
              lastEditedByCharacterId: note.lastEditedByCharacterId,
              lastEditedByName: note.lastEditedByName,
              updatedAt: new Date().toISOString(),
            },
            () =>
              updateNoteOnServer({
                mapId,
                noteId,
                patch: { positionX: snapped.x, positionY: snapped.y },
              }),
          );
        }
        return;
      }
      // Dragging any member of a multi-selection moves the whole group; commit
      // every selected system's new position, not just the grabbed node.
      if (selectedSystemIds.size > 1 && selectedSystemIds.has(node.id)) {
        commitGroupMove();
        return;
      }
      const existing = viewData.systems.find((s) => s.id === node.id);
      if (!existing) return;
      // Snap the drop, then nudge to the nearest free slot only if it landed on
      // another node. Searching from the snapped drop keeps the nudge minimal.
      const snapped = snapPointToGrid(node.position);
      const occupiedOthers: Point[] = viewData.systems
        .filter((s) => s.id !== node.id)
        .map((s) => ({ x: s.positionX, y: s.positionY }));
      const final = occupiedOthers.some((o) => overlaps(snapped, o))
        ? findOpenPosition(snapped, occupiedOthers)
        : snapped;
      if (existing.positionX === final.x && existing.positionY === final.y) return;
      const patch: UpdateSystemBody = { positionX: final.x, positionY: final.y };
      runOptimistic(
        {
          kind: 'system.updated',
          eventId: 0,
          id: node.id,
          positionX: final.x,
          positionY: final.y,
        },
        () => updateSystemOnServer({ mapId, mapSystemId: node.id, patch }),
      );
    },
    [mapId, viewData.systems, viewData.notes, selectedSystemIds, commitGroupMove, runOptimistic],
  );

  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target || params.source === params.target) return;
      awaitServer(() =>
        createConnectionOnServer({
          mapId,
          body: {
            sourceMapSystemId: params.source!,
            targetMapSystemId: params.target!,
            scope: 'wh',
          },
        }),
      );
    },
    [mapId, awaitServer],
  );

  // Manually place a system on the map (no wormhole jump). Anchor on the
  // selected system's position when one is selected, else the viewport centre
  // (falling back to (0,0) before the instance is ready), then settle into the
  // nearest open, grid-aligned slot so adds never overlap existing nodes.
  // POST → fold the returned payloads (the new system + any auto-created gate
  // links to systems already on the map) like a bulk paste.
  const onAddSystem = useCallback(
    (systemId: number) => {
      const occupied: Point[] = viewData.systems.map((s) => ({ x: s.positionX, y: s.positionY }));
      let anchor: Point | null = null;
      const pending = pendingAddPoint.current;
      if (pending) {
        pendingAddPoint.current = null;
        const inst = flowInstance.current;
        if (inst) anchor = inst.screenToFlowPosition({ x: pending.x, y: pending.y });
      }
      if (!anchor && selected?.kind === 'system') {
        const sel = viewData.systems.find((s) => s.id === selected.id);
        if (sel) anchor = { x: sel.positionX, y: sel.positionY };
      }
      if (!anchor) {
        anchor = { x: 0, y: 0 };
        const inst = flowInstance.current;
        const wrap = flowWrapperRef.current;
        if (inst && wrap) {
          const rect = wrap.getBoundingClientRect();
          anchor = inst.screenToFlowPosition({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          });
        }
      }
      const pos = findOpenPosition(anchor, occupied);
      void addSystemOnServer({
        mapId,
        systemId,
        positionX: pos.x,
        positionY: pos.y,
      }).then((result) => {
        if (result.ok) onBulkPaste(result.data.payloads);
      });
    },
    [mapId, onBulkPaste, selected, viewData.systems],
  );

  // Pane "Add system" entry point: remember the cursor point so `onAddSystem`
  // places the chosen system there, then open the existing picker dialog.
  const onAddSystemAt = useCallback((clientX: number, clientY: number) => {
    pendingAddPoint.current = { x: clientX, y: clientY };
    setContextMenu(null);
    setAddSystemOpen(true);
  }, []);

  // ---- Note callbacks ----------------------------------------------------
  // Select a note into the inspector (wired to the node's double-click via the
  // sync block's `data.onOpen`). Stable for the component lifetime.
  const onOpenNote = useCallback((noteId: string) => {
    setSelected({ kind: 'note', id: noteId });
    setSelectedSystemIds(new Set());
  }, []);

  // Pane "Add note here": convert the cursor's client point to flow coords, snap,
  // and POST immediately (notes need no picker dialog). The awaited payload folds
  // the new note in; the user double-clicks it to edit.
  const onAddNoteAt = useCallback(
    (clientX: number, clientY: number) => {
      setContextMenu(null);
      const inst = flowInstance.current;
      const point: Point = inst
        ? inst.screenToFlowPosition({ x: clientX, y: clientY })
        : { x: 0, y: 0 };
      const pos = snapPointToGrid(point);
      awaitServer(() =>
        addNoteOnServer({
          mapId,
          body: { title: 'New note', positionX: pos.x, positionY: pos.y },
        }),
      );
    },
    [mapId, awaitServer],
  );

  const onNotePatch = useCallback(
    (noteId: string, patch: UpdateNoteBody) => {
      const note = viewData.notes.find((n) => n.id === noteId);
      // `note.updated` always carries title + editor attribution + updatedAt; the
      // changed fields ride from `patch`. Optimistic attribution keeps the current
      // values (the authoritative echo replaces them with the real actor).
      const opt: MapEventPayload = {
        kind: 'note.updated',
        eventId: 0,
        id: noteId,
        title: note?.title ?? '',
        lastEditedByCharacterId: note?.lastEditedByCharacterId ?? null,
        lastEditedByName: note?.lastEditedByName ?? null,
        updatedAt: new Date().toISOString(),
        ...patch,
      };
      runOptimistic(opt, () => updateNoteOnServer({ mapId, noteId, patch }));
    },
    [mapId, viewData.notes, runOptimistic],
  );

  const onNoteRemove = useCallback(
    (noteId: string) => {
      const note = viewData.notes.find((n) => n.id === noteId);
      runOptimistic(
        { kind: 'note.deleted', eventId: 0, id: noteId, title: note?.title ?? '' },
        () => deleteNoteOnServer({ mapId, noteId }),
      );
      setSelected(null);
    },
    [mapId, viewData.notes, runOptimistic],
  );

  // Click selection is driven by direct handlers (they own single + Ctrl+click
  // toggle), while `onSelectionChange` is used only as a box-select reconciler
  // (see below). The two don't fight because the reconciler ignores size<=1 and
  // no-ops when xyflow's set already matches ours.
  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      // Notes select singly into the inspector — no multi-select / group semantics.
      if (node.type === 'note') {
        setSelected({ kind: 'note', id: (node.data as MapNoteNodeData).id });
        setSelectedSystemIds(new Set());
        return;
      }
      // Ctrl/Cmd+click toggles the node in the group. The inspector primary is
      // cleared whenever 2+ are selected — a multi-select group drives no
      // inspector / per-system module (which would otherwise thrash on refetch);
      // a lone survivor re-populates it.
      if (event.ctrlKey || event.metaKey) {
        const next = new Set(selectedSystemIds);
        if (next.has(node.id)) next.delete(node.id);
        else next.add(node.id);
        setSelectedSystemIds(next);
        setSelected(next.size === 1 ? { kind: 'system', id: next.values().next().value! } : null);
        return;
      }
      setSelected({ kind: 'system', id: node.id });
      setSelectedSystemIds(new Set([node.id]));
    },
    [selectedSystemIds],
  );

  const onEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    setSelected({ kind: 'connection', id: edge.id });
    setSelectedSystemIds(new Set());
  }, []);

  const onPaneClick = useCallback(() => {
    setSelected(null);
    setSelectedSystemIds(new Set());
  }, []);

  // Right-click handlers. Each suppresses the native browser menu and stores the
  // cursor point + target; selection is intentionally left untouched.
  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    if (node.type === 'note') {
      setContextMenu({
        kind: 'note',
        id: (node.data as MapNoteNodeData).id,
        x: event.clientX,
        y: event.clientY,
      });
      return;
    }
    setContextMenu({ kind: 'system', id: node.id, x: event.clientX, y: event.clientY });
  }, []);

  const onEdgeContextMenu = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.preventDefault();
    setContextMenu({ kind: 'connection', id: edge.id, x: event.clientX, y: event.clientY });
  }, []);

  const onPaneContextMenu = useCallback((event: MouseEvent | React.MouseEvent) => {
    event.preventDefault();
    setContextMenu({ kind: 'pane', x: event.clientX, y: event.clientY });
  }, []);

  const onSelectionStart = useCallback(() => {
    boxSelecting.current = true;
  }, []);

  const onSelectionEnd = useCallback(() => {
    boxSelecting.current = false;
    // Mixed multi-selection is unsupported: if the box caught systems *and* notes,
    // prioritize systems and drop the notes from xyflow's selection — otherwise the
    // notes group-drag with the systems but commit through a different path and
    // rubber-band back on release. A pure-note box is left intact (its multi-note
    // drag reads xyflow's selection directly). Done once at box end so it never
    // fights xyflow's per-move re-selection during the draw.
    const live = flowInstance.current?.getNodes() ?? [];
    const hasSystem = live.some((n) => n.type === 'system' && n.selected);
    const hasNote = live.some((n) => n.type === 'note' && n.selected);
    if (hasSystem && hasNote) {
      setNodes((prev) =>
        prev.map((n) => (n.type === 'note' && n.selected ? { ...n, selected: false } : n)),
      );
    }
  }, []);

  // Box-select-only reconciler. xyflow fires `onSelectionChange` for *every*
  // selection mutation — including the echoes of our own click handlers — so we
  // adopt only while a drag box is active (`boxSelecting`). Adopting on click
  // echoes would fight the click handlers and loop. Single/empty stay owned by
  // the click/pane handlers; the diff check skips a no-op rebuild. The inspector
  // primary is cleared (same rule as Ctrl+click) so the box drag doesn't thrash
  // the per-system modules as nodes enter the rectangle.
  const onSelectionChange = useCallback(
    ({ nodes: selNodes }: OnSelectionChangeParams) => {
      if (!boxSelecting.current) return;
      // `selectedSystemIds` holds system ids only — group ops (move, "Remove N")
      // route through the systems endpoints. Notes caught by the box select
      // singly into the inspector, never the group; drop them here.
      const ids = selNodes.filter((n) => n.type === 'system').map((n) => n.id);
      if (ids.length <= 1) return;
      if (ids.length === selectedSystemIds.size && ids.every((id) => selectedSystemIds.has(id))) {
        return;
      }
      setSelectedSystemIds(new Set(ids));
      setSelected(null);
    },
    [selectedSystemIds],
  );

  // ---- Inspector callbacks -----------------------------------------------
  const onSystemPatch = useCallback(
    (mapSystemId: string, patch: UpdateSystemBody) => {
      const opt: MapEventPayload = {
        kind: 'system.updated',
        eventId: 0,
        id: mapSystemId,
        ...patch,
      };
      runOptimistic(opt, () => updateSystemOnServer({ mapId, mapSystemId, patch }));
    },
    [mapId, runOptimistic],
  );

  const onSystemRemove = useCallback(
    (mapSystemId: string) => {
      runOptimistic({ kind: 'system.removed', eventId: 0, id: mapSystemId }, () =>
        removeSystemOnServer({ mapId, mapSystemId }),
      );
      setSelected(null);
      setSelectedSystemIds(new Set());
    },
    [mapId, runOptimistic],
  );

  // Group delete — driven by the floating "Remove N" button only. There is
  // deliberately no Delete/Backspace keybind: a stray backspace (e.g. while an
  // input is unfocused) must never wipe systems off the map. Loops the existing
  // single-item DELETE endpoint (the onBulkPaste precedent: small, hand-selected
  // groups need no batch endpoint).
  // The Home system and any locked systems are protected from group delete: the
  // server rejects deleting them anyway (Home with a toast, locked outright), so
  // exempting them here avoids the visual delete-then-reappear flicker. Drives
  // both the "Remove N" count and the delete loop.
  const deletableSelectedSystemIds = useMemo(() => {
    const homeId = viewData.map.homeMapSystemId;
    const locked = new Set(viewData.systems.filter((s) => s.locked).map((s) => s.id));
    return [...selectedSystemIds].filter((id) => id !== homeId && !locked.has(id));
  }, [selectedSystemIds, viewData.map.homeMapSystemId, viewData.systems]);

  // How many of the current selection are locked (and so excluded from the group
  // delete) — feeds the "Remove N" button's hint so the count discrepancy is
  // explained rather than silent.
  const lockedSelectedCount = useMemo(() => {
    const locked = new Set(viewData.systems.filter((s) => s.locked).map((s) => s.id));
    return [...selectedSystemIds].filter((id) => locked.has(id)).length;
  }, [selectedSystemIds, viewData.systems]);

  const removeSelectedSystems = useCallback(() => {
    for (const id of deletableSelectedSystemIds) {
      runOptimistic({ kind: 'system.removed', eventId: 0, id }, () =>
        removeSystemOnServer({ mapId, mapSystemId: id }),
      );
    }
    setSelected(null);
    setSelectedSystemIds(new Set());
  }, [mapId, runOptimistic, deletableSelectedSystemIds]);

  const onConnectionPatch = useCallback(
    (connectionId: string, patch: UpdateConnectionBody) => {
      const opt: MapEventPayload = {
        kind: 'connection.update',
        eventId: 0,
        id: connectionId,
        ...patch,
      };
      runOptimistic(opt, () => updateConnectionOnServer({ mapId, connectionId, patch }));
    },
    [mapId, runOptimistic],
  );

  const onConnectionDelete = useCallback(
    (connectionId: string) => {
      runOptimistic({ kind: 'connection.delete', eventId: 0, id: connectionId }, () =>
        deleteConnectionOnServer({ mapId, connectionId }),
      );
      setSelected(null);
    },
    [mapId, runOptimistic],
  );

  const onSignatureCreate = useCallback(
    (body: CreateSignatureBody) => {
      awaitServer(() => createSignatureOnServer({ mapId, body }));
    },
    [mapId, awaitServer],
  );

  const onSignaturePatch = useCallback(
    (signatureId: string, patch: UpdateSignatureBody) => {
      const opt: MapEventPayload = {
        kind: 'signature.update',
        eventId: 0,
        id: signatureId,
        ...patch,
      };
      runOptimistic(opt, () => updateSignatureOnServer({ mapId, signatureId, patch }));
    },
    [mapId, runOptimistic],
  );

  // If a deleted sig resolved to a wormhole, build the "delete the subchain
  // behind it?" offer. Head = the connection's far end; anchor mirrors the two
  // context-menu paths (Home when set, else the sig's own system — always a
  // neighbour of head). Returns null on any missing piece or an empty subchain.
  // Computed against the current (pre-removal) graph, so callers must invoke it
  // before folding the delete into `viewData`.
  const buildSubchainSigOffer = useCallback(
    (sig: MapSignature | undefined): SubchainSigOffer | null => {
      if (!sig || sig.mapConnectionId == null) return null;
      const conn = viewData.connections.find((c) => c.id === sig.mapConnectionId);
      if (!conn) return null;
      const headId = conn.source === sig.mapSystemId ? conn.target : conn.source;
      const anchorId = viewData.map.homeMapSystemId ?? sig.mapSystemId;
      const ids = computeSubchain({
        systems: viewData.systems,
        connections: viewData.connections,
        headId,
        anchorId,
      });
      if (ids.size === 0) return null;
      const head = viewData.systems.find((s) => s.id === headId);
      return {
        headId,
        anchorId,
        headName: head ? head.alias?.trim() || head.name : headId,
        count: ids.size,
      };
    },
    [viewData],
  );

  const onSignatureDelete = useCallback(
    (signatureId: string) => {
      const sig = viewData.signatures.find((s) => s.id === signatureId);
      runOptimistic({ kind: 'signature.delete', eventId: 0, id: signatureId }, () =>
        deleteSignatureOnServer({ mapId, signatureId }),
      );
      const offer = buildSubchainSigOffer(sig);
      if (offer) setSubchainSigPrompts((q) => [...q, offer]);
    },
    [mapId, runOptimistic, viewData, buildSubchainSigOffer],
  );

  // Scan committed paste payloads for wormhole sigs whose remembered connection
  // is currently dormant — i.e. absent from the (pre-fold) view — and turn each
  // into a restore offer. A re-pasted surviving sig commits a `signature.update`
  // carrying a full `snapshot`; a brand-new sig commits `signature.create`.
  // De-duped by connection id; multiple wh sigs → multiple offers.
  const buildRestoreOffers = useCallback(
    (payloads: MapEventPayload[]): RestoreConnOffer[] => {
      const offers: RestoreConnOffer[] = [];
      const seen = new Set<string>();
      for (const p of payloads) {
        const body =
          p.kind === 'signature.update' ? p.snapshot : p.kind === 'signature.create' ? p : null;
        if (!body) continue;
        if (body.groupKey !== 'wormhole') continue;
        const connId = body.mapConnectionId;
        if (connId == null || seen.has(connId)) continue;
        // Present in the view ⇒ confirmed/visible, nothing to restore.
        if (viewData.connections.some((c) => c.id === connId)) continue;
        seen.add(connId);
        const far =
          body.leadsToMapSystemId != null
            ? viewData.systems.find((s) => s.id === body.leadsToMapSystemId)
            : undefined;
        const targetName = far
          ? far.alias?.trim() || far.name
          : (body.wormholeCode ?? 'wormhole');
        offers.push({ connId, targetName });
      }
      return offers;
    },
    [viewData],
  );

  // Fold a signature paste into state, then offer to restore any dormant
  // connection the paste re-confirmed (built from the pre-fold graph). Used by
  // both signature-paste entry points (the CTRL+V hotkey and the panel dialog).
  const onSignaturePasteResult = useCallback(
    (payloads: MapEventPayload[]) => {
      const offers = buildRestoreOffers(payloads);
      onBulkPaste(payloads);
      if (offers.length > 0) setRestoreConnPrompts((q) => [...q, ...offers]);
    },
    [onBulkPaste, buildRestoreOffers],
  );

  // Fold a lazy-delete paste into state, then offer the subchain prompt for each
  // wormhole sig the paste removed — the same prompt the row trash icon raises —
  // plus a restore offer for any dormant connection it re-confirmed. Offers are
  // built from the pre-fold graph, then `onBulkPaste` applies the changes.
  const onLazyDeletePasteResult = useCallback(
    (payloads: MapEventPayload[]) => {
      const offers: SubchainSigOffer[] = [];
      for (const p of payloads) {
        if (p.kind !== 'signature.delete') continue;
        const offer = buildSubchainSigOffer(viewData.signatures.find((s) => s.id === p.id));
        if (offer) offers.push(offer);
      }
      const restoreOffers = buildRestoreOffers(payloads);
      onBulkPaste(payloads);
      if (offers.length > 0) setSubchainSigPrompts((q) => [...q, ...offers]);
      if (restoreOffers.length > 0) setRestoreConnPrompts((q) => [...q, ...restoreOffers]);
    },
    [onBulkPaste, buildSubchainSigOffer, buildRestoreOffers, viewData],
  );

  // ---- Delete subchain ----------------------------------------------------
  // Compute the doomed set from the current view (head + everything orphaned
  // from the keep-side anchor), highlight it, and open the confirm dialog. The
  // server recomputes the set authoritatively on confirm.
  const openSubchainPreview = useCallback(
    (headId: string, anchorId: string) => {
      const ids = computeSubchain({
        systems: viewData.systems,
        connections: viewData.connections,
        headId,
        anchorId,
      });
      if (ids.size === 0) return;
      const head = viewData.systems.find((s) => s.id === headId);
      setSelected(null);
      setSelectedSystemIds(new Set(ids));
      setSubchainPreview({
        headId,
        anchorId,
        headName: head ? head.alias?.trim() || head.name : headId,
        count: ids.size,
      });
    },
    [viewData],
  );

  const onDeleteSubchain = useCallback(
    (headId: string) => {
      const homeId = viewData.map.homeMapSystemId;
      if (homeId === null) return; // the menu only offers this when a Home is set
      openSubchainPreview(headId, homeId);
    },
    [viewData.map.homeMapSystemId, openSubchainPreview],
  );

  const onDeleteSubchainPick = useCallback(
    (headId: string, anchorId: string) => openSubchainPreview(headId, anchorId),
    [openSubchainPreview],
  );

  const onCancelSubchain = useCallback(() => {
    setSubchainPreview(null);
    setSelectedSystemIds(new Set());
  }, []);

  const onConfirmSubchain = useCallback(async () => {
    if (!subchainPreview) return;
    const { headId, anchorId } = subchainPreview;
    setSubchainPreview(null);
    const result = await deleteSubchainOnServer({
      mapId,
      headMapSystemId: headId,
      anchorMapSystemId: anchorId,
    });
    if (result.ok) onBulkPaste(result.data.payloads);
    setSelectedSystemIds(new Set());
  }, [subchainPreview, mapId, onBulkPaste]);

  const dismissSubchainSig = useCallback(() => {
    setSubchainSigPrompts((q) => q.slice(1));
  }, []);

  const onConfirmSubchainSig = useCallback(async () => {
    const active = subchainSigPrompts[0];
    if (!active) return;
    setSubchainSigPrompts((q) => q.slice(1));
    const result = await deleteSubchainOnServer({
      mapId,
      headMapSystemId: active.headId,
      anchorMapSystemId: active.anchorId,
    });
    if (result.ok) onBulkPaste(result.data.payloads);
  }, [subchainSigPrompts, mapId, onBulkPaste]);

  const dismissRestoreConn = useCallback(() => {
    setRestoreConnPrompts((q) => q.slice(1));
  }, []);

  const onConfirmRestoreConn = useCallback(async () => {
    const active = restoreConnPrompts[0];
    if (!active) return;
    setRestoreConnPrompts((q) => q.slice(1));
    const result = await restoreConnectionOnServer({ mapId, connectionId: active.connId });
    if (result.ok) onBulkPaste(result.data.payloads);
  }, [restoreConnPrompts, mapId, onBulkPaste]);

  // ---- Delete disconnected -----------------------------------------------
  // Compute the systems cut off from the Home, highlight them, and open the
  // confirm dialog. The server recomputes the set authoritatively on confirm.
  const onDeleteDisconnected = useCallback(() => {
    const homeId = viewData.map.homeMapSystemId;
    if (homeId === null) return; // the menu only offers this when a Home is set
    const ids = computeDisconnected({
      systems: viewData.systems,
      connections: viewData.connections,
      homeId,
    });
    if (ids.size === 0) return;
    setSelected(null);
    setSelectedSystemIds(new Set(ids));
    setDisconnectedPreview({ count: ids.size });
  }, [viewData]);

  const onCancelDisconnected = useCallback(() => {
    setDisconnectedPreview(null);
    setSelectedSystemIds(new Set());
  }, []);

  const onConfirmDisconnected = useCallback(async () => {
    if (!disconnectedPreview) return;
    setDisconnectedPreview(null);
    const result = await deleteDisconnectedOnServer({ mapId });
    if (result.ok) onBulkPaste(result.data.payloads);
    setSelectedSystemIds(new Set());
  }, [disconnectedPreview, mapId, onBulkPaste]);

  // Ping: fire-and-forget broadcast. No optimistic apply — the underglow arrives
  // over realtime for everyone (this client included) via `MapUnderglowBridge`.
  const onPingSystem = useCallback(
    (mapSystemId: string) => {
      void pingSystemOnServer({ mapId, mapSystemId });
    },
    [mapId],
  );

  const onMoveEnd = useCallback(
    (_: MouseEvent | TouchEvent | null, vp: Viewport) => {
      localStorage.setItem(`aperture:map:${mapId}:viewport`, JSON.stringify(vp));
    },
    [mapId],
  );

  const onAliasOrTagCommit = useCallback(
    (mapSystemId: string, field: 'alias' | 'tag', next: string | null) => {
      onSystemPatch(mapSystemId, { [field]: next });
    },
    [onSystemPatch],
  );

  // ---- xyflow nodes/edges ------------------------------------------------
  //
  // `nodes` is xyflow-managed via `applyNodeChanges` (so the visual drag is
  // smooth — without `onNodesChange` xyflow would emit position events with
  // nowhere to land). When `viewData.systems` or `selectedSystemIds` change we
  // reconcile xyflow's nodes state against them, preserving each node's
  // in-flight drag position (xyflow sets `dragging: true` mid-drag) and
  // xyflow-internal fields (`measured`, etc.) by spreading the existing node
  // — without that xyflow would re-measure on every sync and the nodes
  // briefly flicker out. We sync during render (rather than in an effect) so
  // React discards the pre-sync render before commit instead of cascading.
  // `onAliasOrTagCommit` isn't in the sync key because it's stable for the
  // component's lifetime (its dep chain bottoms out at `mapId` + `useCallback`s
  // with empty deps).
  const [lastSync, setLastSync] = useState<{
    systems: MapViewData['systems'];
    notes: MapViewData['notes'];
    selectedSystemIds: Set<string>;
    // The note-node halo is driven by the inspector `selected` ref (notes have no
    // multi-select set), so a note selection change must trigger a re-sync.
    selected: SelectionRef | null;
    intel: Record<number, SystemIntelSummary>;
  } | null>(null);
  if (
    !lastSync ||
    lastSync.systems !== viewData.systems ||
    lastSync.notes !== viewData.notes ||
    lastSync.selectedSystemIds !== selectedSystemIds ||
    lastSync.selected !== selected ||
    // `intel` is replaced by reference when a live-added system's data backfills;
    // re-sync so its decorators (sov/FW/incursion) appear without a systems change.
    lastSync.intel !== intel
  ) {
    setLastSync({ systems: viewData.systems, notes: viewData.notes, selectedSystemIds, selected, intel });
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return [
        ...viewData.systems.map((s) => {
          const existing = prevById.get(s.id);
          const position = existing?.dragging
            ? existing.position
            : { x: s.positionX, y: s.positionY };
          return {
            ...(existing ?? {}),
            id: s.id,
            type: 'system' as const,
            position,
            data: {
              ...s,
              onAliasOrTagCommit,
              isHome: s.id === viewData.map.homeMapSystemId,
              inFactionWarfare: intel[s.systemId]?.factionWar != null,
              hasIncursion: intel[s.systemId]?.incursion != null,
            },
            selected: selectedSystemIds.has(s.id),
            draggable: !s.locked,
          };
        }),
        ...viewData.notes.map((n) => {
          const existing = prevById.get(noteNodeId(n.id));
          const position = existing?.dragging
            ? existing.position
            : { x: n.positionX, y: n.positionY };
          return {
            ...(existing ?? {}),
            id: noteNodeId(n.id),
            type: 'note' as const,
            position,
            data: { ...n, onOpen: onOpenNote },
            selected: selected?.kind === 'note' && selected.id === n.id,
            draggable: !n.locked,
          };
        }),
      ];
    });
  }

  const edges = useMemo<Edge<ConnectionEdgeData>[]>(() => {
    // Group connections by canonical node pair (sorted) so parallel edges
    // (multiple wormholes between the same two systems) can be fanned out.
    const groups = new Map<string, string[]>();
    for (const c of viewData.connections) {
      const key = [c.source, c.target].sort().join('\0');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(c.id);
    }
    for (const ids of groups.values()) ids.sort();

    return viewData.connections.map((c) => {
      const key = [c.source, c.target].sort().join('\0');
      const group = groups.get(key)!;
      const parallelIndex = group.indexOf(c.id);
      const parallelCount = group.length;
      return {
        id: c.id,
        type: 'connection',
        source: c.source,
        target: c.target,
        data: { ...c, parallelIndex, parallelCount },
        selected: selected?.kind === 'connection' && selected.id === c.id,
      };
    });
  }, [viewData.connections, selected]);

  const selectedSystem: MapSystemNode | null = useMemo(() => {
    if (selected?.kind !== 'system') return null;
    return viewData.systems.find((s) => s.id === selected.id) ?? null;
  }, [selected, viewData.systems]);

  // EVE solar-system ids already placed — lets the add dialog flag duplicates.
  const existingSystemIds = useMemo(
    () => new Set(viewData.systems.map((s) => s.systemId)),
    [viewData.systems],
  );

  // Visible map systems for the settings dialog's Auto-tagging Home picker.
  const manageSystems = useMemo(
    () =>
      [...viewData.systems]
        .map((s) => ({ id: s.id, name: s.name, alias: s.alias }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [viewData.systems],
  );

  // ---- Structure-intel callbacks -----------------------------------------
  //
  // Plain REST (no map event, no realtime echo): await the server, then update
  // local state with the returned row. Failures already toast via the client
  // wrappers, so we just leave local state untouched.
  const sortByName = (a: StructureIntel, b: StructureIntel) => a.name.localeCompare(b.name);

  const onStructureCreate = useCallback(
    async (values: StructureFormValues) => {
      if (!selectedSystem) return;
      const systemId = selectedSystem.systemId;
      const result = await createStructureOnServer({ systemId, ...values });
      if (!result.ok) return;
      setStructures((prev) => ({
        ...prev,
        [systemId]: [...(prev[systemId] ?? []), result.data].sort(sortByName),
      }));
    },
    [selectedSystem],
  );

  const onStructurePatch = useCallback(async (structureId: string, values: StructureFormValues) => {
    const result = await updateStructureOnServer({ structureId, patch: values });
    if (!result.ok) return;
    const updated = result.data;
    setStructures((prev) => ({
      ...prev,
      [updated.systemId]: (prev[updated.systemId] ?? [])
        .map((s) => (s.id === structureId ? updated : s))
        .sort(sortByName),
    }));
  }, []);

  const onStructureDelete = useCallback(
    async (structureId: string) => {
      if (!selectedSystem) return;
      const systemId = selectedSystem.systemId;
      const result = await deleteStructureOnServer({ structureId });
      if (!result.ok) return;
      setStructures((prev) => ({
        ...prev,
        [systemId]: (prev[systemId] ?? []).filter((s) => s.id !== structureId),
      }));
    },
    [selectedSystem],
  );

  // Panels the user hasn't hidden, in registry order. Order is cosmetic — the
  // grid positions by each item's `i`, not by child order.
  const visiblePanels = PANELS.filter((p) => !layout.hidden.includes(p.id));

  // The JSX for one panel's body. The canvas keeps its own positioned wrapper
  // (overlays + menu + dialog); the rest are the existing sidebar/signature
  // modules with unchanged props.
  const panelContent = (id: PanelId) => {
    switch (id) {
      case 'canvas':
        return (
          <div
            ref={flowWrapperRef}
            className="relative h-full overflow-hidden rounded-lg ring-1 ring-foreground/10"
          >
            {selectedSystemIds.size > 1 &&
              deletableSelectedSystemIds.length > 0 &&
              !subchainPreview &&
              !disconnectedPreview && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={removeSelectedSystems}
                  title={
                    lockedSelectedCount > 0
                      ? `${lockedSelectedCount} locked system${lockedSelectedCount > 1 ? 's' : ''} excluded — unlock to remove`
                      : undefined
                  }
                  className="nodrag nopan absolute right-2 top-2 z-10"
                >
                  <Trash2 />
                  Remove {deletableSelectedSystemIds.length}
                  {lockedSelectedCount > 0 && (
                    <span className="ml-1 text-[10px] opacity-80">({lockedSelectedCount} locked)</span>
                  )}
                </Button>
              )}
            <TransitSignaturePrompt
              mapId={mapId}
              systems={viewData.systems}
              connections={viewData.connections}
              signatures={viewData.signatures}
              viewerCharacters={viewerCharacters}
              onPatchSignature={onSignaturePatch}
              onConnectionPatch={onConnectionPatch}
            />
            {subchainSigPrompts[0] && (
              <SubchainDeletePrompt
                headName={subchainSigPrompts[0].headName}
                count={subchainSigPrompts[0].count}
                onConfirm={onConfirmSubchainSig}
                onDismiss={dismissSubchainSig}
              />
            )}
            {restoreConnPrompts[0] && (
              <RestoreConnectionPrompt
                targetName={restoreConnPrompts[0].targetName}
                onConfirm={onConfirmRestoreConn}
                onDismiss={dismissRestoreConn}
              />
            )}
            {subchainPreview && (
              <SubchainDeletePrompt
                lead="Delete subchain beyond"
                headName={subchainPreview.headName}
                count={subchainPreview.count}
                onConfirm={onConfirmSubchain}
                onDismiss={onCancelSubchain}
              />
            )}
            {disconnectedPreview && (
              <SubchainDeletePrompt
                lead="Delete systems disconnected from Home"
                count={disconnectedPreview.count}
                onConfirm={onConfirmDisconnected}
                onDismiss={onCancelDisconnected}
              />
            )}
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodeClick={onNodeClick}
              onEdgeClick={onEdgeClick}
              onPaneClick={onPaneClick}
              onNodeContextMenu={onNodeContextMenu}
              onEdgeContextMenu={onEdgeContextMenu}
              onPaneContextMenu={onPaneContextMenu}
              onSelectionStart={onSelectionStart}
              onSelectionEnd={onSelectionEnd}
              onSelectionChange={onSelectionChange}
              onInit={(inst) => {
                flowInstance.current = inst;
              }}
              onNodesChange={onNodesChange}
              onNodeDragStop={onNodeDragStop}
              onConnect={onConnect}
              snapToGrid
              snapGrid={[GRID_SIZE, GRID_SIZE]}
              nodesDraggable
              nodesConnectable
              selectionKeyCode={['Control', 'Meta']}
              multiSelectionKeyCode={['Control', 'Meta']}
              selectionMode={SelectionMode.Partial}
              deleteKeyCode={null}
              connectionMode={ConnectionMode.Loose}
              edgesFocusable
              colorMode="dark"
              fitView={initialViewport === null}
              defaultViewport={initialViewport ?? undefined}
              zoomOnScroll={false}
              preventScrolling={false}
              onMoveEnd={onMoveEnd}
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
            <MapContextMenu
              target={contextMenu}
              onClose={() => setContextMenu(null)}
              systems={viewData.systems}
              connections={viewData.connections}
              homeMapSystemId={viewData.map.homeMapSystemId}
              selectedSystemIds={selectedSystemIds}
              onSystemPatch={onSystemPatch}
              onSystemRemove={onSystemRemove}
              onSystemRemoveSelected={removeSelectedSystems}
              onConnectionPatch={onConnectionPatch}
              onConnectionDelete={onConnectionDelete}
              onAddSystemAt={onAddSystemAt}
              onDeleteSubchain={onDeleteSubchain}
              onDeleteSubchainPick={onDeleteSubchainPick}
              onDeleteDisconnected={onDeleteDisconnected}
              onPingSystem={onPingSystem}
              notes={viewData.notes}
              onAddNoteAt={onAddNoteAt}
              onNotePatch={onNotePatch}
              onNoteRemove={onNoteRemove}
            />
          </div>
        );
      case 'signatures':
        return (
          <SignatureModule
            mapId={mapId}
            system={selectedSystem}
            signatures={viewData.signatures}
            connections={viewData.connections}
            systems={viewData.systems}
            onCreate={onSignatureCreate}
            onPatch={onSignaturePatch}
            onDelete={onSignatureDelete}
            onConnectionPatch={onConnectionPatch}
            flashSigId={flashSigId}
          />
        );
      case 'inspector':
        return (
          <InspectorModule
            selected={selected}
            viewData={viewData}
            onSystemPatch={onSystemPatch}
            onSystemRemove={onSystemRemove}
            onConnectionPatch={onConnectionPatch}
            onConnectionDelete={onConnectionDelete}
            onNotePatch={onNotePatch}
            onNoteRemove={onNoteRemove}
          />
        );
      case 'route':
        return (
          <RoutePlannerModule
            mapId={mapId}
            selectedSystemId={selectedSystem?.systemId ?? null}
            initialPrefs={routePrefs}
            initialDestinations={routeDestinations}
            connections={viewData.connections}
          />
        );
      case 'intel':
        return (
          <IntelModule
            system={selectedSystem}
            intel={selectedSystem ? intel[selectedSystem.systemId] : undefined}
          />
        );
      case 'structure':
        return (
          <StructureModule
            system={selectedSystem}
            structures={selectedSystem ? (structures[selectedSystem.systemId] ?? []) : []}
            onCreate={onStructureCreate}
            onPatch={onStructurePatch}
            onDelete={onStructureDelete}
          />
        );
      case 'killStats':
        return (
          <KillStatsModule
            system={selectedSystem}
            stats={selectedSystem ? stats[selectedSystem.systemId] : undefined}
          />
        );
      case 'systemGraph':
        return <SystemGraphModule system={selectedSystem} />;
      case 'systemKillboard':
        return <SystemKillboardModule system={selectedSystem} />;
      case 'tags':
        return <TagsModule viewData={viewData} selectedSystemId={selectedSystem?.id ?? null} />;
      case 'thera':
        return <TheraModule mapId={mapId} viewData={viewData} onBulkPaste={onBulkPaste} />;
    }
  };

  const panelHeaderRight = (id: PanelId): ReactNode => {
    if (id === 'signatures') {
      return (
        <SignatureModuleHeaderActions
          mapId={mapId}
          system={selectedSystem}
          signatures={viewData.signatures}
          onBulkPaste={onSignaturePasteResult}
          lazyDelete={lazyDeleteSigs}
          onLazyDeleteChange={setLazyDeleteSigs}
          onOpenSearch={() => setSigSearchOpen(true)}
        />
      );
    }
    return undefined;
  };

  return (
    <MapPresenceProvider initial={data.presence}>
      <MapActiveCharProvider viewerCharacters={viewerCharacters} mainCharacterId={mainCharacterId}>
      <MapTravelProvider>
        <MapUnderglowProvider>
        <MapSignatureIndicatorProvider
          signatures={viewData.signatures}
          prefs={signatureIndicators}
        >
        {travelAnimation && (
          <TravelBridge systems={viewData.systems} connections={viewData.connections} />
        )}
        <MapUnderglowBridge systems={viewData.systems} />
        <SignaturePasteHotkey
          mapId={mapId}
          selectedSystem={selectedSystem}
          systems={viewData.systems}
          viewerCharacterIds={viewerCharacterIds}
          onBulkPaste={onSignaturePasteResult}
          lazyDelete={lazyDeleteSigs}
          onLazyDeleteConsume={() => setLazyDeleteSigs(false)}
          onLazyDeletePasteResult={onLazyDeletePasteResult}
        />
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-1">
            <div className="min-w-0">
              <div className="font-heading truncate text-base font-semibold tracking-tight">
                {viewData.map.name}
              </div>
              <div className="text-muted-foreground truncate text-xs capitalize">
                {viewData.map.type} · {viewData.map.scope} · {viewData.systems.length} systems
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <ActiveCharSelector />
              <PilotRosterButton viewData={viewData} />
              <SystemOverlayButton viewData={viewData} />
              <Menu>
                <MenuTrigger
                  render={
                    <Button variant="ghost" size="sm">
                      <LayoutDashboard />
                      Panels
                    </Button>
                  }
                />
                <MenuContent>
                  {PANELS.map((p) => (
                    <MenuCheckboxItem
                      key={p.id}
                      checked={!layout.hidden.includes(p.id)}
                      onCheckedChange={() => handleToggleVisible(p.id)}
                    >
                      {p.title}
                    </MenuCheckboxItem>
                  ))}
                  <MenuSeparator />
                  <MenuItem icon={<RotateCcw />} onClick={handleResetLayout}>
                    Reset layout
                  </MenuItem>
                </MenuContent>
              </Menu>
              <Button variant="ghost" size="sm" onClick={() => setAddSystemOpen(true)}>
                <Plus />
                Add system
              </Button>

              <Button variant="ghost" size="sm" onClick={() => setSigSearchOpen(true)}>
                <Search />
                Sig Search
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setMapInfoOpen(true)}>
                <Info />
                Map info
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}>
                <Settings />
                Settings
              </Button>
              {canManage && (
                <Button variant="ghost" size="sm" onClick={() => setAuditOpen(true)}>
                  <ScrollText />
                  Audit log
                </Button>
              )}
            </div>
          </div>
          <MapLayoutGrid layouts={layout.layouts} onLayoutChange={handleLayoutChange}>
            {visiblePanels.map((p) => (
              <div key={p.id}>
                <MapPanel
                  id={p.id}
                  title={p.title}
                  onHide={handleHide}
                  headerRight={panelHeaderRight(p.id)}
                  contentClassName={
                    p.id === 'canvas' ? 'min-h-0 flex-1 overflow-hidden p-0' : undefined
                  }
                >
                  {panelContent(p.id)}
                </MapPanel>
              </div>
            ))}
          </MapLayoutGrid>
        </div>

        <MapInfoDialog open={mapInfoOpen} onOpenChange={setMapInfoOpen} viewData={viewData} />
        <MapSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          mapId={mapId}
          settings={settings}
          canManage={canManage}
          systems={manageSystems}
          onImported={onBulkPaste}
        />
        {canManage && (
          <MapAuditDialog
            open={auditOpen}
            onOpenChange={setAuditOpen}
            mapId={mapId}
            mapName={settings.name}
          />
        )}
        <AddSystemDialog
          open={addSystemOpen}
          onOpenChange={setAddSystemOpen}
          mapId={mapId}
          existingSystemIds={existingSystemIds}
          onAdd={onAddSystem}
        />
        <SignatureSearchDialog
          open={sigSearchOpen}
          onOpenChange={setSigSearchOpen}
          signatures={viewData.signatures}
          systems={viewData.systems}
          filters={sigSearchFilters}
          onFiltersChange={setSigSearchFilters}
          onNavigate={handleNavigateToSig}
        />
        </MapSignatureIndicatorProvider>
        </MapUnderglowProvider>
      </MapTravelProvider>
      </MapActiveCharProvider>
    </MapPresenceProvider>
  );
}
