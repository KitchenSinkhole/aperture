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
import { arrayMove } from '@dnd-kit/sortable';
import type { Layout, ResponsiveLayouts } from 'react-grid-layout';
import type {
  Breakpoint,
  ConnectionEnd,
  LiveShareBadge,
  MapCapability,
  MapContextMenuTarget,
  MapEventPayload,
  ExperimentalLayoutPreset,
  MapLayoutConfig,
  MapSettings,
  MapSignature,
  SignatureGroupKey,
  MapSystemNode,
  MapViewData,
  PanelGroup,
  PanelId,
  RouteDestinationView,
  MapActiveRouteView,
  MapRouteFavouriteView,
  RoutePlan,
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
  MANUAL_SLOT,
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
  fetchWormholeCatalog,
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
import { connectionMassLogLoadSchema, mapUpdateLoadSchema, type Envelope } from '@/lib/realtime/protocol';
import {
  useMapSubscription,
  useRealtimeEvents,
  useReconnectResync,
} from '@/lib/realtime/useRealtime';
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
import {
  Copy,
  Download,
  Info,
  LayoutDashboard,
  RotateCcw,
  ScrollText,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  User,
} from 'lucide-react';
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
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/menu';
import { MapInfoDialog } from '@/components/dialogs/MapInfoDialog';
import { dropWatchedConnection } from '@/lib/connectionWatchPrefs';
import { getSoundEngine, useSoundCueOn } from '@/lib/sounds/engine';
import { PilotRosterButton } from './PilotRosterButton';
import { SoundToolbarButton } from './SoundToolbarButton';
import { SystemOverlayButton } from './SystemOverlayButton';
import { MapShareIndicator } from './MapShareIndicator';
import { MapSettingsDialog } from '@/components/dialogs/MapSettingsDialog';
import { MapAuditDialog } from '@/components/map/manage/MapAuditDialog';
import { SignatureSearchModule } from '@/components/sidebar/SignatureSearchModule';
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
import { PresenceSoundBridge } from './PresenceSoundBridge';
import { RallySoundBridge } from './RallySoundBridge';
import { ExperimentalActiveRouteBridge } from './ExperimentalActiveRouteBridge';
import { ExperimentalPanelGearProvider } from './experimentalPanelGear';
import { pushKspaceWaypointsForCharacter } from '@/lib/character/pushRouteWaypoints';
import { ExperimentalCombatRingProvider } from './ExperimentalCombatRingContext';
import { ExperimentalCombatKillBridge } from './ExperimentalCombatKillBridge';
import { ExperimentalSoundGateProvider } from './ExperimentalSoundGate';
import { ExperimentalFollowPilotBridge } from './ExperimentalFollowPilotBridge';
import {
  isSystemMutedForDisplay,
  mergeSoundPanelSettings,
  mutedSystemsForMap,
  parseExperimentalSoundLayoutSettings,
  setSystemMuteAll,
  toggleSystemMuteEvent,
  type ExperimentalSoundLayoutSettings,
} from '@/lib/experimentalSoundLayout';
import { activeRouteConnectionIds, remainingActiveRouteHops } from '@/lib/map/activeRouteMonitor';
import type { SoundEvent } from '@/lib/sounds/prefs';
import { MapJumpToSystemDialog } from './MapJumpToSystemDialog';
import { ExperimentalUndoHotkeys } from './ExperimentalUndoHotkeys';
import { CurrentRoutePanel } from '@/components/sidebar/CurrentRoutePanel';
import { ExperimentalPilotsPanel } from '@/components/sidebar/ExperimentalPilotsPanel';
import { ExperimentalKillsPanel } from '@/components/sidebar/ExperimentalKillsPanel';
import { ExperimentalDscanPanel } from '@/components/sidebar/ExperimentalDscanPanel';
import { SystemNotificationSoundBridge } from './SystemNotificationSoundBridge';
import { WatchedConnectionSoundBridge } from './WatchedConnectionSoundBridge';
import { SystemNode, type SystemNodeData } from './SystemNode';
import { MapNoteNode, type MapNoteNodeData } from './MapNoteNode';
import { MapContextMenu } from './MapContextMenu';
import { SubchainDeletePrompt } from './SubchainDeletePrompt';
import { RestoreConnectionPrompt } from './RestoreConnectionPrompt';
import { applyExperimentalPanelCollapse } from '@/lib/map/layout/experimentalCollapse';
import { MapCommandPalette, useMapCommandPaletteKeyboard } from './MapCommandPalette';
import {
  focusSystemActionLabel,
  matchSystemsForFocus,
} from '@/lib/map/commandPaletteSystemFocus';
import { ExperimentalThemeToggle } from './ExperimentalThemeToggle';
import { MapStyleProvider } from './MapStyleContext';
import { MapLinkHoverProvider } from './MapLinkHoverContext';
import { homePathConnectionIds } from '@/lib/map/homePath';
import type { MapStyleOptions } from './styling';
import { MapLayoutGrid } from './layout/MapLayoutGrid';
import { MapPanelGroup } from './layout/MapPanelGroup';
import { PanelDndContext } from './layout/PanelDndContext';
import {
  defaultMapLayoutForUi,
  PANELS,
  PANEL_COLS,
  PANEL_MIN,
  dedupeGroups,
  ensurePanelsPlaced,
  mergePanelIntoGroup,
  migrateLayout,
  removePanelFromLayout,
} from '@/lib/map/layout/panels';
import { mapLayoutConfigSchema } from '@/lib/map/layout/schema';
import { setMapLayoutAction } from '@/app/(app)/actions/account';
import { clearMapActiveRouteAction } from '@/app/(app)/actions/mapActiveRoute';
import { experimentalMapStyleVariant, isExperimentalUiActive } from '@/lib/experimentalUi';
import { experimentalLayoutPreset } from '@/lib/experimentalLayoutPresets';
import {
  DEFAULT_SIGNATURE_CLEANUP_SETTINGS,
  SignatureCleanupDialog,
  type SignatureCleanupPanelSettings,
} from '@/components/dialogs/SignatureCleanupDialog';
import {
  ExperimentalPanelAddButton,
  experimentalPanelSupportsAdd,
} from '@/components/map/experimentalPanelHeaderActions';
import {
  requestExperimentalPanelAdd,
  subscribeExperimentalPanelAdd,
} from '@/lib/experimentalPanelActionBus';
import { readExperimentalAutoMassFromLog, readKeepMapSelection } from '@/lib/experimentalQolPrefs';
import { experimentalSettingLabel } from '@/lib/experimentalSettingLabel';
import {
  readExperimentalIncludeJumpBridge,
  subscribeExperimentalRoutePrefs,
  writeExperimentalIncludeJumpBridge,
} from '@/lib/experimentalRoutePrefs';
import { massStatusFromCumulative } from '@/lib/experimentalAutoMass';
import { fetchWormholeJumpInfo } from '@/lib/reference/client';
import type { WormholeJumpInfoRow } from '@/types';
import { useExperimentalUi } from '@/lib/experimentalUi.client';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import {
  experimentalUndoHydrateFromStorage,
  experimentalUndoPush,
  experimentalUndoPushSignature,
  experimentalUndoSetExecutor,
} from '@/lib/experimentalPanelUndo';
import {
  runSignatureUndoPayload,
  snapshotPatchInverse,
  type SignatureUndoPayload,
  type SignatureUndoRuntime,
} from '@/lib/experimentalSignatureUndo';

// Debounce window for persisting layout edits (drag/resize/hide) to the server.
const LAYOUT_SAVE_DEBOUNCE_MS = 600;

function parseSignatureCleanupSettings(
  layout: MapLayoutConfig,
): SignatureCleanupPanelSettings {
  const raw = layout.panelSettings?.signatures;
  if (!raw || typeof raw !== 'object') return DEFAULT_SIGNATURE_CLEANUP_SETTINGS;
  const scope = raw.scope === 'chain' ? 'chain' : 'system';
  const groups = Array.isArray(raw.groups)
    ? raw.groups.filter((g): g is SignatureGroupKey => typeof g === 'string')
    : DEFAULT_SIGNATURE_CLEANUP_SETTINGS.groups;
  return {
    scope,
    olderThanHours:
      typeof raw.olderThanHours === 'number'
        ? raw.olderThanHours
        : raw.olderThanHours === null
          ? null
          : DEFAULT_SIGNATURE_CLEANUP_SETTINGS.olderThanHours,
    unscannedOnly: raw.unscannedOnly === true,
    staleByIndicator: raw.staleByIndicator !== false,
    whLinkExpired: raw.whLinkExpired === true,
    groups,
  };
}

const COMMAND_PANEL_FOCUS_ORDER: PanelId[] = ['signatures', 'inspector', 'route', 'intel'];

// Cadence for re-pulling read-side per-system intel/stats for systems already on
// the map. Floored at the ~5min server refresh-job cadence — polling faster than
// the underlying data changes would just be waste against the shared deployment.
const SYSTEM_DATA_REFRESH_MS = 5 * 60 * 1000;

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
  structureIntelEnabled,
  settings,
  canManage,
  capabilities,
  liveShares: initialLiveShares,
  travelAnimation,
  signatureIndicators,
  viewerCharacterIds,
  viewerCharacters,
  mainCharacterId,
  routePrefs,
  routeDestinations,
  mapLayout,
  initialExperimentalUi,
  mapRouteFavourites = [],
  mapActiveRoute = null,
}: {
  data: MapViewData;
  stats: Record<number, SystemStatsSummary>;
  intel: Record<number, SystemIntelSummary>;
  structures: Record<number, StructureIntel[]>;
  /**
   * Whether the viewer belongs to the entity that owns this map. False for a
   * guest admitted by a role grant, whose Structures panel is inert — structure
   * intel is scoped to the owning entity, so a guest can neither read nor write
   * any of it here.
   */
  structureIntelEnabled: boolean;
  settings: MapSettings;
  /**
   * Whether the viewer holds derived management authority (`canManageMap`) —
   * reveals the manager-only Roles & Permissions tab in `MapSettingsDialog`.
   * The other management surfaces reveal on `capabilities` instead.
   */
  canManage: boolean;
  /**
   * The delegated map capabilities the viewer holds (`resolveMapCapabilities`).
   * A manager holds every value; a delegated corp title holds the subset granted
   * to it. Drives per-feature reveal of the director-gated surfaces.
   */
  capabilities: MapCapability[];
  /** Share links currently publishing this map, for the header indicator every viewer sees. */
  liveShares: LiveShareBadge[];
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
  /** SSR-resolved experimental UI mode for seeding the default layout when `mapLayout` is null. */
  initialExperimentalUi: import('@/lib/experimentalUi').ExperimentalUiMode;
  mapRouteFavourites?: MapRouteFavouriteView[];
  mapActiveRoute?: MapActiveRouteView | null;
}) {
  const [selected, setSelected] = useState<SelectionRef | null>(null);
  const [lastPrimarySystem, setLastPrimarySystem] = useState<MapSystemNode | null>(null);
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
  const [commandOpen, setCommandOpen] = useState(false);
  const [jumpPickerOpen, setJumpPickerOpen] = useState(false);
  const whMassRef = useRef<WormholeJumpInfoRow[] | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [addSystemOpen, setAddSystemOpen] = useState(false);
  const [sigSearchFilters, setSigSearchFilters] = useState<SigSearchFilters>({
    name: '',
    groupKey: null,
    maxAgeHours: null,
    securityClasses: [],
    includeAnomalies: true,
    includeSignatures: true,
    activity: null,
  });
  const [flashSigId, setFlashSigId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Sonar-ping highlight of sigs a local bulk paste created/updated (issue #209).
  const [pasteFlash, setPasteFlash] = useState<Record<string, 'created' | 'updated'>>({});
  const pasteFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One-shot "Lazy delete" arm for the CTRL+V fast paste: when on, the next
  // direct scanner paste also removes missing sigs, then disarms itself.
  const [lazyDeleteSigs, setLazyDeleteSigs] = useState(false);
  const [sigCleanupOpen, setSigCleanupOpen] = useState(false);
  const [panelGearJumpBridge, setPanelGearJumpBridge] = useState(readExperimentalIncludeJumpBridge);

  useEffect(
    () => subscribeExperimentalRoutePrefs(() => setPanelGearJumpBridge(readExperimentalIncludeJumpBridge())),
    [],
  );
  const [viewData, setViewData] = useState<MapViewData>(data);
  const [liveShares, setLiveShares] = useState<LiveShareBadge[]>(initialLiveShares);
  // Captured via ReactFlow's onInit so the manual-add flow can place new nodes
  // at the current viewport centre rather than (0,0).
  const flowInstance = useRef<ReactFlowInstance<CanvasNode, Edge<ConnectionEdgeData>> | null>(null);
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
  const requestedSystemData = useRef<Set<number>>(new Set(Object.keys(initialIntel).map(Number)));
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

  // Distinct EVE system ids currently on the map, mirrored into a ref so the
  // periodic refresh below reads a fresh set without re-arming its interval on
  // every viewData change (drag, realtime, optimistic patch).
  const onMapSystemIds = useMemo(
    () => [...new Set(viewData.systems.map((s) => s.systemId))],
    [viewData.systems],
  );
  const onMapSystemIdsRef = useRef(onMapSystemIds);
  useEffect(() => {
    onMapSystemIdsRef.current = onMapSystemIds;
  }, [onMapSystemIds]);

  // Read-side intel/stats drift as their server refresh jobs (incursion, sov/FW,
  // hourly stats) run; a long-lived open map never picks that up. Re-pull the
  // whole on-map set on an interval and reference-replace intel/stats so the
  // node-sync key rebuilds decorators. Skips while the tab is hidden to avoid
  // polling the shared deployment for a view nobody is looking at. Structures are
  // deliberately not re-merged: they carry the user's own un-echoed CRUD edits
  // and have no server refresh job, so overwriting them would only risk clobber.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const systemIds = onMapSystemIdsRef.current;
      if (systemIds.length === 0) return;
      fetchSystemData({ mapId: data.map.id, systemIds }).then((result) => {
        if (!result.ok) return;
        setIntel((prev) => ({ ...prev, ...result.data.intel }));
        setStats((prev) => ({ ...prev, ...result.data.stats }));
      });
    }, SYSTEM_DATA_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [data.map.id]);

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
  // `migrateLayout` upgrades a pre-v2 blob (no grouping) to singleton groups;
  // `dedupeGroups` heals any panel that a stale build resurrected as a duplicate
  // cell; `ensurePanelsPlaced` then auto-places any registered panel missing from
  // a saved layout (a panel that shipped after the user last saved). All are
  // normalisers, no data migration. No-ops for `DEFAULT_MAP_LAYOUT` (already
  // current and complete).
  const [experimentalUi, setExperimentalUi] = useExperimentalUi(initialExperimentalUi);
  const experimentalActive = isExperimentalUiActive(experimentalUi);
  const mapStyleOpts = useMemo<MapStyleOptions>(() => {
    if (!experimentalActive) {
      return { palette: 'default', theme: 'dark' };
    }
    const variant = experimentalMapStyleVariant(experimentalUi);
    return {
      palette: variant === 'aperture' ? 'default' : 'experimental',
      theme: variant === 'light' ? 'light' : 'dark',
      importanceLinks: true,
      variant,
    };
  }, [experimentalActive, experimentalUi]);
  const emptyHighlightSet = useMemo(() => new Set<string>(), []);
  const activeRouteId = mapActiveRoute?.id ?? null;
  const [highlightClearedRouteId, setHighlightClearedRouteId] = useState<string | null>(null);
  const activeRouteLocallyCleared =
    activeRouteId != null && highlightClearedRouteId === activeRouteId;
  const [planHighlightSuppressedRouteId, setPlanHighlightSuppressedRouteId] =
    useState<string | null>(null);
  const planHighlightSuppressed =
    activeRouteId != null && planHighlightSuppressedRouteId === activeRouteId;
  const [planRouteHighlightConnectionIds, setPlanRouteHighlightConnectionIds] =
    useState<ReadonlySet<string>>(() => new Set());
  const [planRouteHighlightMapSystemIds, setPlanRouteHighlightMapSystemIds] =
    useState<ReadonlySet<string>>(() => new Set());
  const activeRouteHighlight = useMemo(() => {
    if (!experimentalActive || !mapActiveRoute || activeRouteLocallyCleared) {
      return { connections: emptyHighlightSet, systems: emptyHighlightSet };
    }
    const byEve = new Map(viewData.systems.map((s) => [s.systemId, s.id]));
    return {
      connections: new Set(activeRouteConnectionIds(mapActiveRoute.hops)),
      systems: new Set(
        mapActiveRoute.hops
          .map((h) => byEve.get(h.systemId))
          .filter((id): id is string => id != null),
      ),
    };
  }, [
    activeRouteLocallyCleared,
    emptyHighlightSet,
    experimentalActive,
    mapActiveRoute,
    viewData.systems,
  ]);
  const routeHighlightConnectionIds = useMemo(() => {
    if (experimentalActive && mapActiveRoute && !activeRouteLocallyCleared) {
      return activeRouteHighlight.connections;
    }
    return planRouteHighlightConnectionIds;
  }, [
    activeRouteHighlight.connections,
    activeRouteLocallyCleared,
    experimentalActive,
    mapActiveRoute,
    planRouteHighlightConnectionIds,
  ]);
  const routeHighlightMapSystemIds = useMemo(() => {
    if (experimentalActive && mapActiveRoute && !activeRouteLocallyCleared) {
      return activeRouteHighlight.systems;
    }
    return planRouteHighlightMapSystemIds;
  }, [
    activeRouteHighlight.systems,
    activeRouteLocallyCleared,
    experimentalActive,
    mapActiveRoute,
    planRouteHighlightMapSystemIds,
  ]);
  const [routeFocusMapSystemId, setRouteFocusMapSystemId] = useState<string | null>(null);
  const router = useRouter();
  const [pilotHoverSystemId, setPilotHoverSystemId] = useState<string | null>(null);
  const [signatureHoverFarSystemId, setSignatureHoverFarSystemId] = useState<string | null>(null);

  const onRoutePlanHighlight = useCallback(
    (plan: RoutePlan | null) => {
      if (mapActiveRoute && !activeRouteLocallyCleared) return;
      if (!plan?.reachable) {
        setPlanRouteHighlightConnectionIds(new Set());
        setPlanRouteHighlightMapSystemIds(new Set());
        return;
      }
      const byEve = new Map(viewData.systems.map((s) => [s.systemId, s.id]));
      setPlanRouteHighlightConnectionIds(
        new Set(
          plan.hops
            .filter((h) => h.connectionId != null)
            .map((h) => String(h.connectionId)),
        ),
      );
      setPlanRouteHighlightMapSystemIds(
        new Set(
          plan.hops
            .map((h) => byEve.get(h.systemId))
            .filter((id): id is string => id != null),
        ),
      );
    },
    [activeRouteLocallyCleared, mapActiveRoute, viewData.systems],
  );

  const focusMapSystemByEveId = useCallback(
    (eveSystemId: number) => {
      const mapSystem = viewData.systems.find((s) => s.systemId === eveSystemId);
      if (!mapSystem) {
        toast.info('That hop is not on the map.');
        return;
      }
      setSelected({ kind: 'system', id: mapSystem.id });
      setSelectedSystemIds(new Set([mapSystem.id]));
      const inst = flowInstance.current;
      const node = inst?.getNode(mapSystem.id);
      if (inst && node) {
        const w = node.measured?.width ?? node.width ?? 0;
        const h = node.measured?.height ?? node.height ?? 0;
        inst.setCenter(node.position.x + w / 2, node.position.y + h / 2, {
          zoom: Math.max(inst.getZoom(), 0.85),
          duration: 200,
        });
      }
      setRouteFocusMapSystemId(mapSystem.id);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setRouteFocusMapSystemId(null), 3000);
    },
    [viewData.systems],
  );
  const [layout, setLayout] = useState<MapLayoutConfig>(() => {
    const experimentalOnLoad = isExperimentalUiActive(initialExperimentalUi);
    const base =
      mapLayout ??
      defaultMapLayoutForUi(experimentalOnLoad);
    return ensurePanelsPlaced(dedupeGroups(migrateLayout(base)));
  });
  // The grid's active responsive breakpoint (reported by `MapLayoutGrid`). Grouping
  // is per-breakpoint, so the rendered cells read from `layout.groups[breakpoint]`.
  const [breakpoint, setBreakpoint] = useState<Breakpoint>('lg');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // RGL fires `onLayoutChange` once on mount with its normalized layout; that
  // first call updates local state but must not persist (no spurious write per
  // map open). Subsequent (user-driven) changes save.
  const firstLayoutChange = useRef(true);
  const layoutPersistSkipRef = useRef(false);
  const experimentalCollapsedHeightsRef = useRef(new Map<string, number>());
  const [experimentalCollapsedGroups, setExperimentalCollapsedGroups] = useState(
    () => new Set<string>(),
  );

  const handleExperimentalPanelCollapse = useCallback(
    (groupId: string, collapsed: boolean) => {
      setExperimentalCollapsedGroups((prev) => {
        const next = new Set(prev);
        if (collapsed) next.add(groupId);
        else next.delete(groupId);
        return next;
      });
      setLayout((prev) => {
        const bp = breakpoint;
        const items = prev.layouts[bp] ?? [];
        const updated = applyExperimentalPanelCollapse(
          items,
          groupId,
          collapsed,
          experimentalCollapsedHeightsRef.current,
        );
        if (!updated) return prev;
        layoutPersistSkipRef.current = true;
        return { ...prev, layouts: { ...prev.layouts, [bp]: updated } };
      });
    },
    [breakpoint],
  );

  const saveLayout = useCallback((config: MapLayoutConfig) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      // Fire-and-forget: a layout-preference write failing is non-critical.
      void setMapLayoutAction(config);
    }, LAYOUT_SAVE_DEBOUNCE_MS);
  }, []);

  // Flush nothing but cancel a pending debounce on unmount.
  useEffect(() => () => clearTimeout(saveTimer.current ?? undefined), []);
  useEffect(
    () => () => {
      clearTimeout(flashTimer.current ?? undefined);
      clearTimeout(pasteFlashTimer.current ?? undefined);
    },
    [],
  );

  const signatureCleanupSettings = useMemo(
    () => parseSignatureCleanupSettings(layout),
    [layout],
  );

  const persistSignatureCleanupSettings = useCallback(
    (next: SignatureCleanupPanelSettings) => {
      setLayout((prev) => {
        const updated: MapLayoutConfig = {
          ...prev,
          panelSettings: { ...prev.panelSettings, signatures: next },
        };
        saveLayout(updated);
        return updated;
      });
    },
    [saveLayout],
  );

  const soundLayoutSettings = useMemo(
    () => parseExperimentalSoundLayoutSettings(layout),
    [layout],
  );

  const persistSoundLayoutSettings = useCallback(
    (next: ExperimentalSoundLayoutSettings) => {
      setLayout((prev) => {
        const updated = mergeSoundPanelSettings(prev, next);
        saveLayout(updated);
        return updated;
      });
    },
    [saveLayout],
  );

  const applyLayoutPreset = useCallback(
    (preset: ExperimentalLayoutPreset) => {
      const next = ensurePanelsPlaced(dedupeGroups(migrateLayout(experimentalLayoutPreset(preset))));
      setLayout(next);
      firstLayoutChange.current = false;
      saveLayout(next);
      toast.success(`Layout preset: ${preset}`);
    },
    [saveLayout],
  );

  useEffect(
    () => subscribeExperimentalPanelAdd('inspector', () => setAddSystemOpen(true)),
    [],
  );

  const handleLayoutChange = useCallback(
    (_current: Layout, all: ResponsiveLayouts<Breakpoint>) => {
      setLayout((prev) => {
        if (layoutPersistSkipRef.current) {
          layoutPersistSkipRef.current = false;
          return prev;
        }
        const next: MapLayoutConfig = { ...prev, layouts: mergeLayouts(prev.layouts, all) };
        if (!firstLayoutChange.current) saveLayout(next);
        firstLayoutChange.current = false;
        return next;
      });
    },
    [saveLayout],
  );

  // Hide a panel (tab ✕ or panels-menu uncheck). The panel leaves its group's
  // tab strip in every breakpoint (`removePanelFromLayout` re-keys/drops the
  // group as needed, picking a new active tab) and lands in `hidden`.
  const handleHide = useCallback(
    (id: PanelId) => {
      setLayout((prev) => {
        if (prev.hidden.includes(id)) return prev;
        const removed = removePanelFromLayout(prev, id);
        const next: MapLayoutConfig = { ...removed, hidden: [...prev.hidden, id] };
        saveLayout(next);
        return next;
      });
    },
    [saveLayout],
  );

  // Panels-menu checkbox: flip a panel between hidden and visible. Re-showing a
  // panel drops it from `hidden` and `ensurePanelsPlaced` re-adds it as a fresh
  // singleton group at the bottom of each breakpoint (a hidden panel has no
  // preserved slot — hiding removed its group). Hiding routes through the same
  // group-aware removal as the tab ✕.
  const handleToggleVisible = useCallback(
    (id: PanelId) => {
      setLayout((prev) => {
        let next: MapLayoutConfig;
        if (prev.hidden.includes(id)) {
          next = ensurePanelsPlaced({ ...prev, hidden: prev.hidden.filter((h) => h !== id) });
        } else {
          const removed = removePanelFromLayout(prev, id);
          next = { ...removed, hidden: [...prev.hidden, id] };
        }
        saveLayout(next);
        return next;
      });
    },
    [saveLayout],
  );

  // Switch a group's active tab. Applies to every breakpoint that holds a group
  // with this id whose members include the panel (a singleton/reused id spans
  // breakpoints; a per-breakpoint-only group matches only where it exists).
  const handleSetActiveTab = useCallback(
    (groupId: string, panel: PanelId) => {
      setLayout((prev) => {
        const groups = { ...prev.groups };
        for (const bp of Object.keys(prev.groups) as Breakpoint[]) {
          groups[bp] = prev.groups[bp].map((g) =>
            g.id === groupId && g.members.includes(panel) ? { ...g, active: panel } : g,
          );
        }
        const next: MapLayoutConfig = { ...prev, groups };
        saveLayout(next);
        return next;
      });
    },
    [saveLayout],
  );

  // Move a member panel out of its current group and append it as a new active
  // tab of `targetGroupId`, scoped to the active breakpoint (grouping is
  // per-breakpoint). If the source group empties it is dropped, along with its
  // grid item in `layouts[bp]` — `mergeLayouts` keeps only `prev` items, so a
  // removed item is not resurrected by RGL's next `onLayoutChange`.
  const handleMergePanelIntoGroup = useCallback(
    (sourcePanel: PanelId, targetGroupId: string) => {
      setLayout((prev) => {
        const next = mergePanelIntoGroup(prev, breakpoint, sourcePanel, targetGroupId);
        if (next === prev) return prev;
        saveLayout(next);
        return next;
      });
    },
    [breakpoint, saveLayout],
  );

  // Reorder a tab within its own group's header (active breakpoint only). No-op
  // if either panel is missing or the order is unchanged.
  const reorderTab = useCallback(
    (groupId: string, fromPanel: PanelId, toPanel: PanelId) => {
      setLayout((prev) => {
        const bp = breakpoint;
        const group = prev.groups[bp].find((g) => g.id === groupId);
        if (!group) return prev;
        const from = group.members.indexOf(fromPanel);
        const to = group.members.indexOf(toPanel);
        if (from < 0 || to < 0 || from === to) return prev;
        const members = arrayMove(group.members, from, to);
        const groupsBp = prev.groups[bp].map((g) => (g.id === groupId ? { ...g, members } : g));
        const next: MapLayoutConfig = { ...prev, groups: { ...prev.groups, [bp]: groupsBp } };
        saveLayout(next);
        return next;
      });
    },
    [breakpoint, saveLayout],
  );

  // Split a member out of its group into its own new singleton cell at a snapped
  // grid position (active breakpoint only). The new group/layout-item id is the
  // panel's `PanelId` (grid ids live in the `PanelId` space). When the panel is its
  // group's anchor id, the source group + its layout item are first re-keyed to a
  // remaining member so the id isn't claimed by two cells. A singleton source has no
  // group to split — it already owns item `i === source.id`, so this just moves it.
  const tearOffTab = useCallback(
    (panel: PanelId, x: number, y: number) => {
      setLayout((prev) => {
        const bp = breakpoint;
        const source = prev.groups[bp].find((g) => g.members.includes(panel));
        if (!source) return prev;
        const cols = PANEL_COLS[bp];
        const { minW, minH } = PANEL_MIN[panel];
        const w = Math.min(cols, minW);
        const clampedX = Math.max(0, Math.min(x, cols - w));
        const clampedY = Math.max(0, y);

        if (source.members.length === 1) {
          const layoutsBp = prev.layouts[bp].map((it) =>
            it.i === source.id ? { ...it, x: clampedX, y: clampedY } : it,
          );
          const next: MapLayoutConfig = { ...prev, layouts: { ...prev.layouts, [bp]: layoutsBp } };
          saveLayout(next);
          return next;
        }

        const remaining = source.members.filter((m) => m !== panel);
        const newActive = source.active === panel ? remaining[0]! : source.active;

        let groupsBp: PanelGroup[];
        let layoutsBp = prev.layouts[bp];
        if (source.id === panel) {
          const newSourceId = newActive;
          groupsBp = prev.groups[bp].map((g) =>
            g.id === source.id ? { id: newSourceId, members: remaining, active: newActive } : g,
          );
          layoutsBp = layoutsBp.map((it) =>
            it.i === source.id ? { ...it, i: newSourceId, ...PANEL_MIN[newSourceId] } : it,
          );
        } else {
          groupsBp = prev.groups[bp].map((g) =>
            g.id === source.id ? { ...g, members: remaining, active: newActive } : g,
          );
        }

        groupsBp = [...groupsBp, { id: panel, members: [panel], active: panel }];
        layoutsBp = [...layoutsBp, { i: panel, x: clampedX, y: clampedY, w, h: minH, minW, minH }];

        const next: MapLayoutConfig = {
          ...prev,
          groups: { ...prev.groups, [bp]: groupsBp },
          layouts: { ...prev.layouts, [bp]: layoutsBp },
        };
        saveLayout(next);
        return next;
      });
    },
    [breakpoint, saveLayout],
  );

  // dnd-kit drop dispatcher: `overId` is either a `grp:<groupId>` header or a
  // bare `PanelId` tab. Same group ⇒ reorder; different group (or a header) ⇒
  // merge. Resolved against the active breakpoint's groups. A drop on the open grid
  // surface (tear-off) is handled separately by `MapLayoutGrid` and falls through
  // here as a no-op (its `overId` matches no `grp:` prefix and no member).
  const handlePanelDrop = useCallback(
    (activePanel: PanelId, overId: string) => {
      const groupsBp = layout.groups[breakpoint] ?? [];
      if (overId.startsWith('grp:')) {
        handleMergePanelIntoGroup(activePanel, overId.slice(4));
        return;
      }
      const overPanel = overId as PanelId;
      const overGroup = groupsBp.find((g) => g.members.includes(overPanel));
      const sourceGroup = groupsBp.find((g) => g.members.includes(activePanel));
      if (!overGroup || !sourceGroup) return;
      if (overGroup.id === sourceGroup.id) {
        reorderTab(sourceGroup.id, activePanel, overPanel);
      } else {
        handleMergePanelIntoGroup(activePanel, overGroup.id);
      }
    },
    [layout.groups, breakpoint, handleMergePanelIntoGroup, reorderTab],
  );

  // Reset to the shipped arrangement. Clone so later immutable updates can never
  // mutate the shared `DEFAULT_MAP_LAYOUT` constant.
  const handleResetLayout = useCallback(() => {
    const next = structuredClone(defaultMapLayoutForUi(experimentalActive));
    setLayout(next);
    saveLayout(next);
  }, [saveLayout, experimentalActive]);

  // Download the current arrangement as a shareable JSON file. The exported blob
  // is exactly `MapLayoutConfig` — the same shape the import validator accepts.
  const handleExportLayout = useCallback(() => {
    const blob = new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'aperture-layout.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [layout]);

  const handleCopyLayout = useCallback(() => {
    void navigator.clipboard.writeText(JSON.stringify(layout, null, 2)).then(
      () => toast.success('Layout JSON copied'),
      () => toast.error('Could not copy layout'),
    );
  }, [layout]);

  const refreshActiveRouteWaypoints = useCallback(async () => {
    if (!mapActiveRoute) return;
    const charId = mainCharacterId ?? viewerCharacterIds[0] ?? null;
    if (charId == null) {
      toast.error('No character for waypoint push.');
      return;
    }
    const primaryPresence = viewData.presence.find((p) => p.characterId === charId);
    const hops = remainingActiveRouteHops(
      mapActiveRoute.hops,
      mapActiveRoute.waypointCursor,
      primaryPresence?.systemId ?? null,
    );
    const push = await pushKspaceWaypointsForCharacter(charId, hops);
    if (!push.ok) {
      toast.error(push.error);
      return;
    }
    toast.success(`Waypoints refreshed (${push.pushed})`);
    router.refresh();
  }, [mainCharacterId, mapActiveRoute, router, viewData.presence, viewerCharacterIds]);

  // Hidden picker for importing someone else's exported layout file.
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const handleImportFile = useCallback(
    async (file: File) => {
      let raw: unknown;
      try {
        raw = JSON.parse(await file.text());
      } catch {
        toast.error('Not a valid layout file.');
        return;
      }
      // Re-validate the untrusted file at this boundary; `ensurePanelsPlaced`
      // then back-fills any panels absent from a layout saved by another build.
      const parsed = mapLayoutConfigSchema.safeParse(raw);
      if (!parsed.success) {
        toast.error('This file is not a valid Aperture layout.');
        return;
      }
      const next = ensurePanelsPlaced(dedupeGroups(migrateLayout(parsed.data)));
      setLayout(next);
      saveLayout(next);
      toast.success('Layout imported.');
    },
    [saveLayout],
  );

  const handleNavigateToSig = useCallback((systemId: string, sigId: string) => {
    setSelected({ kind: 'system', id: systemId });
    setSelectedSystemIds(new Set([systemId]));
    const inst = flowInstance.current;
    const node = inst?.getNode(systemId);
    if (inst && node) {
      const w = node.measured?.width ?? node.width ?? 0;
      const h = node.measured?.height ?? node.height ?? 0;
      // Snap (no animation) to the system, preserving the current zoom level.
      inst.setCenter(node.position.x + w / 2, node.position.y + h / 2, {
        zoom: inst.getZoom(),
        duration: 0,
      });
    }
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
    useCallback(
      (envelope: Envelope) => {
        if (envelope.task !== 'mapUpdate') return;
        const loadResult = mapUpdateLoadSchema.safeParse(envelope.load);
        if (!loadResult.success || !loadResult.data.data) return;
        // Belt-and-suspenders: the SharedWorker already routes map-scoped
        // envelopes only to subscribed ports, but a foreign mapId reaching this
        // handler (a worker routing regression) must not corrupt this canvas.
        // Checked against the load's mapId, which the schema makes mandatory —
        // the envelope-level tag is optional, so a producer that stopped setting
        // it would leave a guard on it passing everything.
        if (loadResult.data.mapId !== Number(data.map.id)) return;
        const payload = loadResult.data.data;
        if (appliedEventIds.current.has(payload.eventId)) return;
        appliedEventIds.current.add(payload.eventId);
        setViewData((prev) => applyEvent(prev, payload));
        hydrateAddedSystems([payload]);
        // A watch has the lifetime of its hole, so only an actual delete ends it
        // — a system removed from the map hides its connections but keeps them.
        if (payload.kind === 'connection.delete') {
          dropWatchedConnection(data.map.id, payload.id);
        }
        // Share mint/revoke carries no canvas state, so it never reaches
        // `applyEvent` — the header indicator tracks it directly.
        if (payload.kind === 'share.created') {
          const badge: LiveShareBadge = {
            id: payload.shareId,
            label: payload.label,
            expiresAt: payload.expiresAt,
          };
          setLiveShares((prev) => (prev.some((s) => s.id === badge.id) ? prev : [badge, ...prev]));
        } else if (payload.kind === 'share.revoked') {
          setLiveShares((prev) => prev.filter((s) => s.id !== payload.shareId));
        }
      },
      [hydrateAddedSystems, data.map.id],
    ),
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
      // Runs once the server has committed, for the side effects a rollback
      // could not undo.
      onCommitted?: () => void,
    ) => {
      let snapshot: MapViewData | null = null;
      setViewData((prev) => {
        snapshot = prev;
        return applyEvent(prev, optimistic);
      });
      const result = await run();
      if (result.ok) {
        appliedEventIds.current.add(result.eventId);
        onCommitted?.();
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
  const onBulkPaste = useCallback(
    (payloads: MapEventPayload[]) => {
      if (payloads.length === 0) return;
      for (const p of payloads) appliedEventIds.current.add(p.eventId);
      setViewData((prev) => payloads.reduce(applyEvent, prev));
      hydrateAddedSystems(payloads);
      // Registering the eventIds above suppresses the realtime echo for this
      // tab, so the deletes in a bulk result have to end their watches here.
      for (const p of payloads) {
        if (p.kind === 'connection.delete') dropWatchedConnection(data.map.id, p.id);
      }

      const flashes: Record<string, 'created' | 'updated'> = {};
      for (const p of payloads) {
        if (p.kind === 'signature.create') flashes[p.id] = 'created';
        else if (p.kind === 'signature.update') flashes[p.id] = 'updated';
      }
      if (Object.keys(flashes).length > 0) {
        if (pasteFlashTimer.current) clearTimeout(pasteFlashTimer.current);
        setPasteFlash(flashes);
        pasteFlashTimer.current = setTimeout(() => setPasteFlash({}), 2500);
      }
    },
    [hydrateAddedSystems, data.map.id],
  );

  // ---- xyflow → server callbacks -----------------------------------------
  const mapId = viewData.map.id;

  const stopActiveRoute = useCallback(async () => {
    const result = await clearMapActiveRouteAction({ mapId });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Active route stopped.');
    setHighlightClearedRouteId(mapActiveRoute?.id ?? null);
    setPlanHighlightSuppressedRouteId(mapActiveRoute?.id ?? null);
    setPlanRouteHighlightConnectionIds(new Set());
    setPlanRouteHighlightMapSystemIds(new Set());
    setRouteFocusMapSystemId(null);
    router.refresh();
  }, [mapActiveRoute?.id, mapId, router]);

  const mapMutedSystems = useMemo(
    () => mutedSystemsForMap(soundLayoutSettings, mapId),
    [soundLayoutSettings, mapId],
  );

  const experimentalContextMenuSound = useMemo(() => {
    if (!experimentalActive || contextMenu?.kind !== 'system') return undefined;
    const mapSystemId = contextMenu.id;
    const entry = mapMutedSystems?.[mapSystemId];
    return {
      isMuted: isSystemMutedForDisplay(mapMutedSystems, mapSystemId),
      isEventMuted: (event: SoundEvent) =>
        entry?.all === true || entry?.events?.[event] === true,
      onMuteAll: (mute: boolean) => {
        persistSoundLayoutSettings(
          setSystemMuteAll(soundLayoutSettings, mapId, mapSystemId, mute),
        );
      },
      onToggleEventMute: (event: SoundEvent, muted: boolean) => {
        persistSoundLayoutSettings(
          toggleSystemMuteEvent(soundLayoutSettings, mapId, mapSystemId, event, muted),
        );
      },
    };
  }, [
    experimentalActive,
    contextMenu,
    mapMutedSystems,
    mapId,
    persistSoundLayoutSettings,
    soundLayoutSettings,
  ]);

  // Only the tab holding this map's lock plays its cues; standing down on
  // unmount hands the lock to the next waiter.
  useEffect(() => {
    const engine = getSoundEngine();
    engine.setMapId(mapId);
    return () => engine.setMapId(null);
  }, [mapId]);

  // Read from the engine, the one copy of the prefs, so which cue listeners
  // exist always agrees with what the engine will play.
  const soundsOn = useSoundCueOn();
  const pilotArrivedOn = useSoundCueOn('pilotArrived');
  const pilotLeftOn = useSoundCueOn('pilotLeft');
  const watchedJumpOn = useSoundCueOn('watchedJump');
  const killInSystemOn = useSoundCueOn('killInSystem');
  const rallySetOn = useSoundCueOn('rallySet');
  const systemPingedOn = useSoundCueOn('systemPinged');

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
      const final = occupiedOthers.some((o) => overlaps(snapped, o, MANUAL_SLOT))
        ? findOpenPosition(snapped, occupiedOthers, MANUAL_SLOT)
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
      const final = occupiedOthers.some((o) => overlaps(snapped, o, MANUAL_SLOT))
        ? findOpenPosition(snapped, occupiedOthers, MANUAL_SLOT)
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
      const sys = viewData.systems.find((s) => s.id === node.id);
      if (sys) setLastPrimarySystem(sys);
    },
    [selectedSystemIds, viewData.systems],
  );

  const onEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    setSelected({ kind: 'connection', id: edge.id });
    setSelectedSystemIds(new Set());
  }, []);

  const onPaneClick = useCallback(() => {
    if (experimentalActive && readKeepMapSelection()) return;
    setSelected(null);
    setSelectedSystemIds(new Set());
  }, [experimentalActive]);

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

  const onEndpointContextMenu = useCallback(
    (connectionId: string, end: ConnectionEnd, clientX: number, clientY: number) => {
      setContextMenu({ kind: 'connectionEnd', id: connectionId, end, x: clientX, y: clientY });
    },
    [],
  );

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
      const prev = viewData.systems.find((s) => s.id === mapSystemId);
      const opt: MapEventPayload = {
        kind: 'system.updated',
        eventId: 0,
        id: mapSystemId,
        ...patch,
      };
      runOptimistic(opt, () => updateSystemOnServer({ mapId, mapSystemId, patch }));
      if (experimentalActive && prev) {
        const inverse: UpdateSystemBody = {};
        for (const key of Object.keys(patch) as (keyof UpdateSystemBody)[]) {
          const k = key;
          (inverse as Record<string, unknown>)[k] = (prev as Record<string, unknown>)[k];
        }
        experimentalUndoPush('map', {
          label: 'Edit system',
          undo: () => {
            void updateSystemOnServer({ mapId, mapSystemId, patch: inverse });
          },
          redo: () => {
            void updateSystemOnServer({ mapId, mapSystemId, patch });
          },
        });
      }
    },
    [mapId, runOptimistic, experimentalActive, viewData.systems],
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

  useEffect(() => {
    if (!experimentalActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (selected?.kind !== 'connection') return;
      const key = e.key.toLowerCase();
      if (key === 'f') {
        e.preventDefault();
        onConnectionPatch(selected.id, { massStatus: 'fresh' });
      } else if (key === 'r') {
        e.preventDefault();
        onConnectionPatch(selected.id, { massStatus: 'reduced' });
      } else if (key === 'c') {
        e.preventDefault();
        onConnectionPatch(selected.id, { massStatus: 'critical' });
      } else if (key === 'e' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        onConnectionPatch(selected.id, { eolStage: 'eol' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [experimentalActive, selected, onConnectionPatch]);

  useRealtimeEvents(
    useCallback(
      (envelope: Envelope) => {
        if (!experimentalActive || !readExperimentalAutoMassFromLog()) return;
        if (envelope.task !== 'connectionMassLog') return;
        const parsed = connectionMassLogLoadSchema.safeParse(envelope.load);
        if (!parsed.success || parsed.data.mapId !== Number(mapId)) return;
        const { connectionId, cumulativeMass } = parsed.data;
        void (async () => {
          if (!whMassRef.current) {
            const wh = await fetchWormholeJumpInfo();
            if (wh.ok) whMassRef.current = wh.data;
          }
          const sig = viewData.signatures.find((s) => s.mapConnectionId === connectionId);
          const ref = whMassRef.current?.find((r) => r.typeId === sig?.typeId) ?? null;
          const status = massStatusFromCumulative(cumulativeMass, ref?.totalMass ?? null);
          if (!status) return;
          const conn = viewData.connections.find((c) => c.id === connectionId);
          if (!conn || conn.massStatus === status) return;
          onConnectionPatch(connectionId, { massStatus: status });
        })();
      },
      [experimentalActive, mapId, onConnectionPatch, viewData.connections, viewData.signatures],
    ),
  );

  const onConnectionDelete = useCallback(
    (connectionId: string) => {
      runOptimistic(
        { kind: 'connection.delete', eventId: 0, id: connectionId },
        () => deleteConnectionOnServer({ mapId, connectionId }),
        // Only once the delete stands: a rejected delete rolls the edge back
        // and the watch has to come back with it.
        () => dropWatchedConnection(mapId, connectionId),
      );
      setSelected(null);
    },
    [mapId, runOptimistic],
  );

  const signatureUndoRuntime = useMemo((): SignatureUndoRuntime => {
    return {
      mapId,
      getSignatures: () => viewData.signatures,
      deleteSignature: (signatureId) => {
        void deleteSignatureOnServer({ mapId, signatureId }).then((result) => {
          if (result.ok) {
            appliedEventIds.current.add(result.eventId);
            setViewData((prev) => applyEvent(prev, result.data));
          } else void resync();
        });
      },
      createSignature: (body) => {
        void createSignatureOnServer({ mapId, body }).then((result) => {
          if (result.ok) {
            appliedEventIds.current.add(result.eventId);
            setViewData((prev) => applyEvent(prev, result.data));
          } else void resync();
        });
      },
      patchSignature: (signatureId, patch) => {
        const opt: MapEventPayload = {
          kind: 'signature.update',
          eventId: 0,
          id: signatureId,
          ...patch,
        };
        void runOptimistic(opt, () => updateSignatureOnServer({ mapId, signatureId, patch }));
      },
      bulkPaste: (payloads) => onBulkPaste(payloads as MapEventPayload[]),
    };
  }, [mapId, viewData.signatures, runOptimistic, onBulkPaste, resync]);

  useEffect(() => {
    if (!experimentalActive) {
      experimentalUndoSetExecutor('signatures', null);
      return;
    }
    experimentalUndoSetExecutor('signatures', (payload, direction) => {
      runSignatureUndoPayload(signatureUndoRuntime, payload as SignatureUndoPayload, direction);
    });
    experimentalUndoHydrateFromStorage();
  }, [experimentalActive, signatureUndoRuntime]);

  const pushSignatureUndo = useCallback(
    (
      label: string,
      undoPayload: SignatureUndoPayload,
      redoPayload: SignatureUndoPayload | undefined,
    ) => {
      if (!experimentalActive) return;
      experimentalUndoPushSignature(label, undoPayload, redoPayload, signatureUndoRuntime);
    },
    [experimentalActive, signatureUndoRuntime],
  );

  const onSignatureCreateWithId = useCallback(
    async (body: CreateSignatureBody): Promise<string | null> => {
      const result = await createSignatureOnServer({ mapId, body });
      if (!result.ok) {
        void resync();
        return null;
      }
      appliedEventIds.current.add(result.eventId);
      setViewData((prev) => applyEvent(prev, result.data));
      const created = result.data as MapSignature;
      if (experimentalActive) {
        pushSignatureUndo(
          'Add signature',
          { kind: 'delete', snapshot: created },
          {
            kind: 'create',
            forward: body,
            createdId: created.id,
          },
        );
      }
      return created.id;
    },
    [mapId, resync, experimentalActive, pushSignatureUndo],
  );

  const onSignatureCreate = useCallback(
    (body: CreateSignatureBody) => {
      void onSignatureCreateWithId(body);
    },
    [onSignatureCreateWithId],
  );

  const onSignaturePatch = useCallback(
    (signatureId: string, patch: UpdateSignatureBody) => {
      const prev = viewData.signatures.find((s) => s.id === signatureId);
      const opt: MapEventPayload = {
        kind: 'signature.update',
        eventId: 0,
        id: signatureId,
        ...patch,
      };
      runOptimistic(opt, () => updateSignatureOnServer({ mapId, signatureId, patch }));
      if (experimentalActive && prev) {
        const before = snapshotPatchInverse(prev, patch);
        pushSignatureUndo(
          'Edit signature',
          { kind: 'patch', signatureId, before, after: patch },
          { kind: 'patch', signatureId, before: patch, after: before },
        );
      }
    },
    [mapId, runOptimistic, viewData.signatures, experimentalActive, pushSignatureUndo],
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
      if (!sig) return;
      runOptimistic({ kind: 'signature.delete', eventId: 0, id: signatureId }, () =>
        deleteSignatureOnServer({ mapId, signatureId }),
      );
      if (experimentalActive) {
        pushSignatureUndo(
          'Delete signature',
          { kind: 'delete', snapshot: sig },
          { kind: 'delete', snapshot: sig },
        );
      }
      const offer = buildSubchainSigOffer(sig);
      if (offer) setSubchainSigPrompts((q) => [...q, offer]);
    },
    [mapId, runOptimistic, viewData, buildSubchainSigOffer, experimentalActive, pushSignatureUndo],
  );

  const onBulkSignatureCleanup = useCallback(
    (signatureIds: string[]) => {
      const snapshots = signatureIds
        .map((id) => viewData.signatures.find((s) => s.id === id))
        .filter((s): s is MapSignature => s != null);
      for (const id of signatureIds) {
        const sig = viewData.signatures.find((s) => s.id === id);
        runOptimistic({ kind: 'signature.delete', eventId: 0, id }, () =>
          deleteSignatureOnServer({ mapId, signatureId: id }),
        );
        const offer = buildSubchainSigOffer(sig);
        if (offer) setSubchainSigPrompts((q) => [...q, offer]);
      }
      if (experimentalActive && snapshots.length > 0) {
        pushSignatureUndo(
          'Clean up signatures',
          { kind: 'bulkDelete', snapshots },
          { kind: 'bulkDelete', snapshots },
        );
      }
    },
    [mapId, runOptimistic, viewData.signatures, experimentalActive, pushSignatureUndo, buildSubchainSigOffer],
  );

  const onSignatureLinkDrop = useCallback(
    async (connectionId: string, signatureId: string) => {
      const sig = viewData.signatures.find((s) => s.id === signatureId);
      if (!sig) return;
      const conn = viewData.connections.find((c) => c.id === connectionId);
      if (!conn) return;
      if (conn.source !== sig.mapSystemId && conn.target !== sig.mapSystemId) {
        toast.error('That connection is not in this system.');
        return;
      }
      if (
        sig.mapConnectionId != null &&
        sig.mapConnectionId !== connectionId &&
        !viewData.connections.some((c) => c.id === sig.mapConnectionId)
      ) {
        const restored = await restoreConnectionOnServer({ mapId, connectionId: sig.mapConnectionId });
        if (restored.ok) onBulkPaste(restored.data.payloads);
      }
      const patch: UpdateSignatureBody = { mapConnectionId: connectionId };
      if (sig.groupKey !== 'wormhole') patch.groupKey = 'wormhole';
      onSignaturePatch(signatureId, patch);
      if (sig.typeId != null) {
        void fetchWormholeCatalog().then((catalog) => {
          if (!catalog.ok) return;
          const row = catalog.data.find((o) => o.typeId === sig.typeId);
          if (row?.jumpMassClass) onConnectionPatch(connectionId, { jumpMassClass: row.jumpMassClass });
        });
      }
      if (sig.eolStage !== 'none') onConnectionPatch(connectionId, { eolStage: sig.eolStage });
    },
    [viewData, mapId, onBulkPaste, onSignaturePatch, onConnectionPatch],
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
        const targetName = far ? far.alias?.trim() || far.name : (body.wormholeCode ?? 'wormhole');
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
      const systemIds = new Set<string>();
      for (const p of payloads) {
        if (p.kind === 'signature.create') {
          const body = p as MapSignature;
          if (body.mapSystemId) systemIds.add(body.mapSystemId);
        } else if (p.kind === 'signature.update' || p.kind === 'signature.delete') {
          const snap = viewData.signatures.find((s) => s.id === p.id);
          if (snap) systemIds.add(snap.mapSystemId);
        }
      }
      const beforeSnapshots =
        systemIds.size > 0
          ? viewData.signatures.filter((s) => systemIds.has(s.mapSystemId))
          : [...viewData.signatures];
      const offers = buildRestoreOffers(payloads);
      onBulkPaste(payloads);
      if (experimentalActive && beforeSnapshots.length > 0) {
        pushSignatureUndo(
          'Paste signatures',
          { kind: 'bulkPaste', beforeSnapshots, forwardPayloads: payloads },
          { kind: 'bulkPaste', beforeSnapshots: [], forwardPayloads: payloads },
        );
      }
      if (offers.length > 0) setRestoreConnPrompts((q) => [...q, ...offers]);
    },
    [onBulkPaste, buildRestoreOffers, viewData.signatures, experimentalActive, pushSignatureUndo],
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
    pilotHoverSystemId: string | null;
    signatureHoverFarSystemId: string | null;
    routeHighlightMapSystemIds: ReadonlySet<string>;
    routeFocusMapSystemId: string | null;
    mapMutedSystems: ReturnType<typeof mutedSystemsForMap>;
  } | null>(null);
  if (
    !lastSync ||
    lastSync.systems !== viewData.systems ||
    lastSync.notes !== viewData.notes ||
    lastSync.selectedSystemIds !== selectedSystemIds ||
    lastSync.selected !== selected ||
    lastSync.pilotHoverSystemId !== pilotHoverSystemId ||
    lastSync.signatureHoverFarSystemId !== signatureHoverFarSystemId ||
    lastSync.routeHighlightMapSystemIds !== routeHighlightMapSystemIds ||
    lastSync.routeFocusMapSystemId !== routeFocusMapSystemId ||
    lastSync.mapMutedSystems !== mapMutedSystems ||
    // `intel` is replaced by reference when a live-added system's data backfills;
    // re-sync so its decorators (sov/FW/incursion) appear without a systems change.
    lastSync.intel !== intel
  ) {
    setLastSync({
      systems: viewData.systems,
      notes: viewData.notes,
      selectedSystemIds,
      selected,
      intel,
      pilotHoverSystemId,
      signatureHoverFarSystemId,
      routeHighlightMapSystemIds,
      routeFocusMapSystemId,
      mapMutedSystems,
    });
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
              panelHoverLinked:
                experimentalActive &&
                (pilotHoverSystemId === s.id || signatureHoverFarSystemId === s.id),
              onPanelHoverSync: experimentalActive ? setPilotHoverSystemId : undefined,
              routePathLinked:
                experimentalActive &&
                (routeHighlightMapSystemIds.has(s.id) || routeFocusMapSystemId === s.id),
              soundMuted:
                experimentalActive && isSystemMutedForDisplay(mapMutedSystems, s.id),
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

  const homePathEdges = useMemo(
    () => homePathConnectionIds(viewData.map.homeMapSystemId, viewData.connections),
    [viewData.map.homeMapSystemId, viewData.connections],
  );

  const edges = useMemo<Edge<ConnectionEdgeData>[]>(() => {
    // Resolve each connection's source wormhole from its attached signatures,
    // preferring the named side over the K162 reverse-exit (the named hole is the
    // one carrying routing / mass / lifetime static data). Feeds the edge's
    // detail popover.
    const whByConn = new Map<string, { typeId: number; code: string | null }>();
    for (const sig of viewData.signatures) {
      if (sig.mapConnectionId == null || sig.typeId == null) continue;
      const existing = whByConn.get(sig.mapConnectionId);
      if (!existing || (existing.code === 'K162' && sig.wormholeCode !== 'K162')) {
        whByConn.set(sig.mapConnectionId, { typeId: sig.typeId, code: sig.wormholeCode });
      }
    }

    return viewData.connections.map((c) => {
      const wh = whByConn.get(c.id) ?? null;
      return {
        id: c.id,
        type: 'connection',
        source: c.source,
        target: c.target,
        data: {
          ...c,
          mapId: viewData.map.id,
          wormholeTypeId: wh?.typeId ?? null,
          wormholeCode: wh?.code ?? null,
          onEndpointContextMenu,
          isOnHomePath: homePathEdges.has(c.id),
          routeHighlighted: experimentalActive && routeHighlightConnectionIds.has(c.id),
          onSignatureLinkDrop: experimentalActive ? onSignatureLinkDrop : undefined,
        },
        selected: selected?.kind === 'connection' && selected.id === c.id,
      };
    });
  }, [
    viewData.connections,
    viewData.signatures,
    viewData.map.id,
    selected,
    onEndpointContextMenu,
    homePathEdges,
    experimentalActive,
    routeHighlightConnectionIds,
    onSignatureLinkDrop,
  ]);

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
      const result = await createStructureOnServer({ mapId, systemId, ...values });
      if (!result.ok) return;
      setStructures((prev) => ({
        ...prev,
        [systemId]: [...(prev[systemId] ?? []), result.data].sort(sortByName),
      }));
    },
    [mapId, selectedSystem],
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
  // One grid cell per group in the active breakpoint whose members aren't all
  // hidden. `layout.groups[breakpoint]` may be undefined before the first
  // breakpoint report resolves against a hand-authored blob.
  const visibleGroups = (layout.groups[breakpoint] ?? []).filter((g) =>
    g.members.some((m) => !layout.hidden.includes(m)),
  );

  const focusPanelByShortcut = useCallback(
    (index: 0 | 1 | 2 | 3) => {
      const id = COMMAND_PANEL_FOCUS_ORDER[index]!;
      const group = (layout.groups[breakpoint] ?? []).find((g) => g.members.includes(id));
      if (!group) return;
      if (group.active !== id) handleSetActiveTab(group.id, id);
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-layout-item-id="${group.id}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    },
    [breakpoint, handleSetActiveTab, layout.groups],
  );

  const fitMapView = useCallback(() => {
    flowInstance.current?.fitView({ padding: 0.15, duration: 300 });
  }, []);

  const centerOnSelectedSystem = useCallback(() => {
    const sys = selectedSystem;
    const inst = flowInstance.current;
    if (!sys || !inst) return;
    const node = inst.getNode(sys.id);
    if (!node) return;
    const w = node.measured?.width ?? node.width ?? 0;
    const h = node.measured?.height ?? node.height ?? 0;
    inst.setCenter(node.position.x + w / 2, node.position.y + h / 2, {
      zoom: inst.getZoom(),
      duration: 300,
    });
  }, [selectedSystem]);

  const jumpToMapSystem = useCallback(
    (mapSystemId: string) => {
      const sys = viewData.systems.find((s) => s.id === mapSystemId);
      if (!sys) return;
      setSelected({ kind: 'system', id: mapSystemId });
      setSelectedSystemIds(new Set([mapSystemId]));
      setLastPrimarySystem(sys);
      const inst = flowInstance.current;
      if (!inst) return;
      const node = inst.getNode(mapSystemId);
      if (!node) return;
      const w = node.measured?.width ?? node.width ?? 0;
      const h = node.measured?.height ?? node.height ?? 0;
      inst.setCenter(node.position.x + w / 2, node.position.y + h / 2, {
        zoom: inst.getZoom(),
        duration: 300,
      });
    },
    [viewData.systems],
  );

  const commandHandlersRef = useRef({
    focusPanelByShortcut,
    fitMapView,
    centerOnSelectedSystem,
    onConnectionPatch,
    setExperimentalUi,
    setSettingsOpen,
    setMapInfoOpen,
  });
  useEffect(() => {
    commandHandlersRef.current = {
      focusPanelByShortcut,
      fitMapView,
      centerOnSelectedSystem,
      onConnectionPatch,
      setExperimentalUi,
      setSettingsOpen,
      setMapInfoOpen,
    };
  }, [
    focusPanelByShortcut,
    fitMapView,
    centerOnSelectedSystem,
    onConnectionPatch,
    setExperimentalUi,
    setSettingsOpen,
    setMapInfoOpen,
  ]);

  /* eslint-disable react-hooks/refs -- palette `run` handlers read commandHandlersRef only when invoked */
  const commandActions = useMemo((): import('./MapCommandPalette').MapCommandAction[] => {
    const actions: import('./MapCommandPalette').MapCommandAction[] = [
      {
        id: 'settings',
        label: 'Map settings',
        keywords: 'preferences',
        run: () => commandHandlersRef.current.setSettingsOpen(true),
      },
      {
        id: 'info',
        label: 'Map info',
        run: () => commandHandlersRef.current.setMapInfoOpen(true),
      },
      {
        id: 'fit',
        label: 'Fit map',
        hint: 'f',
        run: () => commandHandlersRef.current.fitMapView(),
      },
      {
        id: 'maps',
        label: 'Go to maps list',
        keywords: 'home',
        run: () => {
          window.location.href = '/maps';
        },
      },
      {
        id: 'exp-off',
        label: 'Experimental UI: Off',
        run: () => commandHandlersRef.current.setExperimentalUi('off'),
      },
      {
        id: 'exp-aperture',
        label: 'Theme: Aperture (default)',
        run: () => commandHandlersRef.current.setExperimentalUi('aperture'),
      },
      {
        id: 'exp-slate',
        label: 'Theme: Experimental slate',
        run: () => commandHandlersRef.current.setExperimentalUi('slate'),
      },
      {
        id: 'exp-light',
        label: 'Theme: Light',
        run: () => commandHandlersRef.current.setExperimentalUi('light'),
      },
      {
        id: 'exp-classic',
        label: 'Theme: Pathfinder classic',
        run: () => commandHandlersRef.current.setExperimentalUi('classic'),
      },
    ];
    for (const [idx, panel] of COMMAND_PANEL_FOCUS_ORDER.entries()) {
      actions.push({
        id: `focus-${panel}`,
        label: `Focus ${PANELS.find((p) => p.id === panel)?.title ?? panel}`,
        hint: String(idx + 1),
        run: () => commandHandlersRef.current.focusPanelByShortcut(idx as 0 | 1 | 2 | 3),
      });
    }
  if (experimentalActive) {
      const panelAddLabels: Partial<Record<PanelId, string>> = {
        route: 'Routes: Add destination',
        pilots: 'Pilots: Open roster',
        kills: 'Kills: Refresh feed',
        dscan: 'D-Scan: Focus paste',
        thera: 'Eve-Scout: Sync missing',
        inspector: 'Inspector: Add system',
      };
      for (const [panelId, label] of Object.entries(panelAddLabels) as [PanelId, string][]) {
        if (!experimentalPanelSupportsAdd(panelId)) continue;
        actions.push({
          id: `panel-add-${panelId}`,
          label,
          keywords: 'add panel header',
          run: () => requestExperimentalPanelAdd(panelId),
        });
      }
      actions.push({
        id: 'signature-cleanup',
        label: 'Signatures: Clean up…',
        keywords: 'delete stale bulk',
        run: () => setSigCleanupOpen(true),
      });
      actions.push({
        id: 'center-selected',
        label: 'Jump to selected system (center map)',
        keywords: 'pan focus navigate',
        run: () => commandHandlersRef.current.centerOnSelectedSystem(),
      });
      actions.push({
        id: 'jump-picker',
        label: 'Jump to system on map…',
        keywords: 'search pan focus navigate',
        run: () => setJumpPickerOpen(true),
      });
      if (selected?.kind === 'connection') {
        const connId = selected.id;
        actions.push(
          {
            id: 'link-mass-fresh',
            label: 'Selected link: Fresh mass',
            hint: 'f',
            run: () =>
              commandHandlersRef.current.onConnectionPatch(connId, { massStatus: 'fresh' }),
          },
          {
            id: 'link-mass-reduced',
            label: 'Selected link: Reduced mass',
            hint: 'r',
            run: () =>
              commandHandlersRef.current.onConnectionPatch(connId, { massStatus: 'reduced' }),
          },
          {
            id: 'link-mass-critical',
            label: 'Selected link: Critical mass',
            hint: 'c',
            run: () =>
              commandHandlersRef.current.onConnectionPatch(connId, { massStatus: 'critical' }),
          },
          {
            id: 'link-eol',
            label: 'Selected link: Mark EOL',
            hint: 'e',
            run: () => commandHandlersRef.current.onConnectionPatch(connId, { eolStage: 'eol' }),
          },
        );
      }
    }
    return actions;
  }, [experimentalActive, selected]);
  /* eslint-enable react-hooks/refs */

  const resolveCommandPaletteQueryActions = useCallback(
    (query: string) => {
      if (!experimentalActive) return [];
      return matchSystemsForFocus(viewData.systems, query).slice(0, 12).map((m) => ({
        id: `focus-system-${m.system.id}`,
        label: `Focus ${focusSystemActionLabel(m.system)}`,
        hint: m.system.tag ?? m.system.name,
        keywords: `${m.system.name} ${m.system.alias ?? ''} ${m.system.tag ?? ''}`,
        run: () => jumpToMapSystem(m.system.id),
      }));
    },
    [experimentalActive, jumpToMapSystem, viewData.systems],
  );

  useMapCommandPaletteKeyboard({
    enabled: experimentalActive,
    open: commandOpen,
    actions: commandActions,
    onOpenChange: setCommandOpen,
    onFitView: fitMapView,
    onFocusPanel: focusPanelByShortcut,
  });

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
                    <span className="ml-1 text-[10px] opacity-80">
                      ({lockedSelectedCount} locked)
                    </span>
                  )}
                </Button>
              )}
            <TransitSignaturePrompt
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
              colorMode={experimentalActive && experimentalUi === 'light' ? 'light' : 'dark'}
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
              mapId={mapId}
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
              experimentalSound={experimentalContextMenuSound}
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
            onCreateWithId={experimentalActive ? onSignatureCreateWithId : undefined}
            onPatch={onSignaturePatch}
            onDelete={onSignatureDelete}
            onConnectionPatch={onConnectionPatch}
            onBulkPaste={onSignaturePasteResult}
            flashSigId={flashSigId}
            pasteFlash={pasteFlash}
            tagScheme={viewData.map.tagScheme}
            experimentalUi={experimentalActive}
            onSignatureHover={
              experimentalActive
                ? (sig) => {
                    if (!sig?.mapConnectionId) {
                      setSignatureHoverFarSystemId(null);
                      return;
                    }
                    const conn = viewData.connections.find((c) => c.id === sig.mapConnectionId);
                    if (!conn) {
                      setSignatureHoverFarSystemId(null);
                      return;
                    }
                    setSignatureHoverFarSystemId(
                      conn.source === sig.mapSystemId ? conn.target : conn.source,
                    );
                  }
                : undefined
            }
          />
        );
      case 'sigSearch':
        return (
          <SignatureSearchModule
            signatures={viewData.signatures}
            systems={viewData.systems}
            filters={sigSearchFilters}
            onFiltersChange={setSigSearchFilters}
            onNavigate={handleNavigateToSig}
            tagScheme={viewData.map.tagScheme}
            onRowHover={experimentalActive ? setSignatureHoverFarSystemId : undefined}
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
            systems={viewData.systems}
            connections={viewData.connections}
            signatures={viewData.signatures}
            onPlanHighlight={experimentalActive ? onRoutePlanHighlight : undefined}
            planHighlightSuppressed={experimentalActive ? planHighlightSuppressed : undefined}
            onPlanHighlightEngaged={
              experimentalActive ? () => setPlanHighlightSuppressedRouteId(null) : undefined
            }
            onHopClick={experimentalActive ? focusMapSystemByEveId : undefined}
            mapRouteFavourites={experimentalActive ? mapRouteFavourites : undefined}
            viewerCharacters={experimentalActive ? viewerCharacters : []}
            onActiveRouteSaved={
              experimentalActive ? () => router.refresh() : undefined
            }
            stats={experimentalActive ? stats : undefined}
            intel={experimentalActive ? intel : undefined}
            presence={experimentalActive ? viewData.presence : undefined}
            homeMapSystemId={viewData.map.homeMapSystemId}
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
            enabled={structureIntelEnabled}
            structures={selectedSystem ? (structures[selectedSystem.systemId] ?? []) : []}
            mapType={viewData.map.type}
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
      case 'currentRoute':
        return experimentalActive ? (
          <CurrentRoutePanel
            activeRoute={mapActiveRoute}
            viewData={viewData}
            primaryCharacterId={mainCharacterId ?? viewerCharacterIds[0] ?? null}
            onSetRoute={experimentalActive ? () => void refreshActiveRouteWaypoints() : undefined}
            onStopRoute={experimentalActive ? () => void stopActiveRoute() : undefined}
            onHopClick={experimentalActive ? focusMapSystemByEveId : undefined}
          />
        ) : null;
      case 'pilots':
        return experimentalActive ? (
          <ExperimentalPilotsPanel
            viewData={viewData}
            stats={stats}
            linkedMapSystemId={
              pilotHoverSystemId ??
              (selected?.kind === 'system' ? selected.id : null)
            }
            onHoverSystem={setPilotHoverSystemId}
            onSelectSystem={(id) => {
              setSelected({ kind: 'system', id });
              setSelectedSystemIds(new Set([id]));
            }}
          />
        ) : null;
      case 'kills':
        return experimentalActive ? <ExperimentalKillsPanel system={selectedSystem ?? undefined} /> : null;
      case 'dscan':
        return experimentalActive ? <ExperimentalDscanPanel system={selectedSystem ?? undefined} /> : null;
    }
  };

  const renderPanelGearBody = useCallback(
    (id: PanelId): ReactNode => {
      if (!experimentalActive) return null;
      switch (id) {
        case 'canvas':
          return (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={soundLayoutSettings.followSelectedPilot === true}
                onChange={(e) => {
                  persistSoundLayoutSettings({
                    ...soundLayoutSettings,
                    followSelectedPilot: e.target.checked,
                  });
                }}
              />
              {experimentalSettingLabel('Follow selected pilot')}
            </label>
          );
        case 'route':
          return (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={panelGearJumpBridge}
                onChange={(e) => {
                  setPanelGearJumpBridge(e.target.checked);
                  writeExperimentalIncludeJumpBridge(e.target.checked);
                }}
              />
              {experimentalSettingLabel('Include jump bridges')}
            </label>
          );
        case 'pilots':
          return (
            <p className="text-muted-foreground">
              Card hover uses the account {experimentalSettingLabel('Hover delay (ms)')} setting.
            </p>
          );
        default:
          return null;
      }
    },
    [experimentalActive, panelGearJumpBridge, persistSoundLayoutSettings, soundLayoutSettings],
  );

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
          showCleanup={experimentalActive}
          onOpenCleanup={() => setSigCleanupOpen(true)}
        />
      );
    }
    if (experimentalActive && experimentalPanelSupportsAdd(id)) {
      return <ExperimentalPanelAddButton panelId={id} />;
    }
    return undefined;
  };

  return (
    <MapStyleProvider value={mapStyleOpts}>
    <MapLinkHoverProvider>
    <MapPresenceProvider initial={data.presence} mapId={data.map.id}>
      <ExperimentalPanelGearProvider renderGearBody={renderPanelGearBody}>
      <MapActiveCharProvider viewerCharacters={viewerCharacters} mainCharacterId={mainCharacterId}>
        <MapTravelProvider>
          <ExperimentalCombatRingProvider>
          <MapUnderglowProvider>
            <MapSignatureIndicatorProvider
              signatures={viewData.signatures}
              prefs={signatureIndicators}
            >
              {travelAnimation && (
                <TravelBridge systems={viewData.systems} connections={viewData.connections} />
              )}
              <MapUnderglowBridge systems={viewData.systems} mapId={data.map.id} />
              {experimentalActive ? (
                <ExperimentalSoundGateProvider
                  mapId={mapId}
                  settings={soundLayoutSettings}
                  systems={viewData.systems}
                >
                  {(pilotArrivedOn || pilotLeftOn) && (
                    <PresenceSoundBridge
                      mapId={mapId}
                      systems={viewData.systems}
                      connections={viewData.connections}
                      viewerCharacterIds={viewerCharacterIds}
                      watchedJumpOn={watchedJumpOn}
                    />
                  )}
                  {watchedJumpOn && (
                    <WatchedConnectionSoundBridge
                      mapId={mapId}
                      systems={viewData.systems}
                      connections={viewData.connections}
                      viewerCharacterIds={viewerCharacterIds}
                    />
                  )}
                  {(killInSystemOn || systemPingedOn) && (
                    <SystemNotificationSoundBridge mapId={mapId} systems={viewData.systems} />
                  )}
                  {rallySetOn && <RallySoundBridge mapId={mapId} />}
                </ExperimentalSoundGateProvider>
              ) : (
                <>
                  {(pilotArrivedOn || pilotLeftOn) && (
                    <PresenceSoundBridge
                      mapId={mapId}
                      systems={viewData.systems}
                      connections={viewData.connections}
                      viewerCharacterIds={viewerCharacterIds}
                      watchedJumpOn={watchedJumpOn}
                    />
                  )}
                  {watchedJumpOn && (
                    <WatchedConnectionSoundBridge
                      mapId={mapId}
                      systems={viewData.systems}
                      connections={viewData.connections}
                      viewerCharacterIds={viewerCharacterIds}
                    />
                  )}
                  {(killInSystemOn || systemPingedOn) && (
                    <SystemNotificationSoundBridge mapId={mapId} systems={viewData.systems} />
                  )}
                  {rallySetOn && <RallySoundBridge mapId={mapId} />}
                </>
              )}
              {experimentalActive ? (
                <ExperimentalFollowPilotBridge
                  enabled={soundLayoutSettings.followSelectedPilot === true}
                  focusEveSystemId={focusMapSystemByEveId}
                  systems={viewData.systems}
                />
              ) : null}
              {experimentalActive ? (
                <ExperimentalActiveRouteBridge
                  mapId={mapId}
                  activeRoute={mapActiveRoute ?? null}
                  routePrefs={routePrefs}
                  presence={viewData.presence}
                  connections={viewData.connections}
                  primaryCharacterId={mainCharacterId ?? viewerCharacterIds[0] ?? null}
                  onRouteUpdated={() => router.refresh()}
                />
              ) : null}
              {experimentalActive ? <ExperimentalUndoHotkeys /> : null}
              {experimentalActive ? (
                <ExperimentalCombatKillBridge mapId={mapId} systems={viewData.systems} />
              ) : null}
              <SignaturePasteHotkey
                mapId={mapId}
                selectedSystem={selectedSystem}
                fallbackSystem={lastPrimarySystem}
                systems={viewData.systems}
                signatures={viewData.signatures}
                viewerCharacterIds={viewerCharacterIds}
                onBulkPaste={onSignaturePasteResult}
                lazyDelete={lazyDeleteSigs}
                onLazyDeleteConsume={() => setLazyDeleteSigs(false)}
                onLazyDeletePasteResult={onLazyDeletePasteResult}
              />
              <div className="ap-map-dashboard flex flex-col gap-2">
                <div className="flex items-center justify-between gap-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="min-w-0">
                      <div className="font-heading truncate text-base font-semibold tracking-tight experimental:text-lg">
                        {viewData.map.name}
                      </div>
                      <div className="text-muted-foreground truncate text-xs capitalize">
                        {viewData.map.type} · {viewData.map.scope} · {viewData.systems.length}{' '}
                        systems
                      </div>
                    </div>
                    <MapShareIndicator shares={liveShares} />
                  </div>
                  <div className="ap-map-toolbar flex shrink-0 items-center gap-1">
                    {experimentalActive ? (
                      <ExperimentalThemeToggle
                        mode={experimentalUi}
                        onModeChange={setExperimentalUi}
                      />
                    ) : null}
                    {experimentalActive ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSigCleanupOpen(true)}
                        title="Clean up signatures"
                      >
                        <Sparkles />
                        Clean up
                      </Button>
                    ) : null}
                    <ActiveCharSelector />
                    <PilotRosterButton viewData={viewData} />
                    {soundsOn && <SoundToolbarButton />}
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
                        {experimentalActive ? (
                          <>
                            <MenuGroupLabel>Layout presets</MenuGroupLabel>
                            <MenuItem onClick={() => applyLayoutPreset('scanning')}>
                              Scanning focus
                            </MenuItem>
                            <MenuItem onClick={() => applyLayoutPreset('combat')}>
                              Combat focus
                            </MenuItem>
                            <MenuItem onClick={() => applyLayoutPreset('travel')}>
                              Travel focus
                            </MenuItem>
                            <MenuSeparator />
                          </>
                        ) : null}
                        <MenuItem
                          icon={<Copy className="size-3.5" />}
                          onClick={handleCopyLayout}
                        >
                          Copy layout JSON
                        </MenuItem>
                        <MenuItem
                          icon={<Download className="size-3.5" />}
                          onClick={handleExportLayout}
                        >
                          Export layout
                        </MenuItem>
                        <MenuItem
                          icon={<Upload className="size-3.5" />}
                          onClick={() => importInputRef.current?.click()}
                        >
                          Import layout
                        </MenuItem>
                        <MenuItem
                          icon={<RotateCcw className="size-3.5" />}
                          onClick={handleResetLayout}
                        >
                          Reset layout
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                    <input
                      ref={importInputRef}
                      type="file"
                      accept="application/json,.json"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        // Reset so re-selecting the same file fires `change` again.
                        e.target.value = '';
                        if (file) void handleImportFile(file);
                      }}
                    />
                    <Button variant="ghost" size="sm" onClick={() => setMapInfoOpen(true)}>
                      <Info />
                      Map info
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}>
                      <Settings />
                      Settings
                    </Button>
                    {capabilities.includes('audit_view') && (
                      <Button variant="ghost" size="sm" onClick={() => setAuditOpen(true)}>
                        <ScrollText />
                        Audit log
                      </Button>
                    )}
                  </div>
                </div>
                <PanelDndContext onDragEnd={handlePanelDrop}>
                  <MapLayoutGrid
                    layouts={layout.layouts}
                    onLayoutChange={handleLayoutChange}
                    onBreakpointChange={setBreakpoint}
                    onTearOff={tearOffTab}
                    experimentalCollapsedGroupIds={
                      experimentalActive ? experimentalCollapsedGroups : undefined
                    }
                  >
                    {visibleGroups.map((g) => (
                      <div key={g.id}>
                        <MapPanelGroup
                          group={g}
                          hidden={layout.hidden}
                          onSetActive={handleSetActiveTab}
                          onHideMember={handleHide}
                          onExperimentalCollapseChange={
                            experimentalActive ? handleExperimentalPanelCollapse : undefined
                          }
                          renderContent={panelContent}
                          renderHeaderRight={panelHeaderRight}
                          contentClassName={(id) => {
                            if (id === 'canvas') {
                              return experimentalActive
                                ? 'min-h-[40vh] flex-1 overflow-hidden p-0'
                                : 'min-h-0 flex-1 overflow-hidden p-0';
                            }
                            return undefined;
                          }}
                        />
                      </div>
                    ))}
                  </MapLayoutGrid>
                </PanelDndContext>
              </div>

              {experimentalActive ? (
                <MapCommandPalette
                  open={commandOpen}
                  onOpenChange={setCommandOpen}
                  actions={commandActions}
                  resolveQueryActions={resolveCommandPaletteQueryActions}
                />
              ) : null}
              {experimentalActive ? (
                <SignatureCleanupDialog
                  open={sigCleanupOpen}
                  onOpenChange={setSigCleanupOpen}
                  mapId={mapId}
                  selectedSystem={selectedSystem}
                  systems={viewData.systems}
                  signatures={viewData.signatures}
                  connections={viewData.connections}
                  indicatorPrefs={signatureIndicators}
                  settings={signatureCleanupSettings}
                  onSettingsChange={persistSignatureCleanupSettings}
                  onDeleteSignatures={onBulkSignatureCleanup}
                />
              ) : null}
              <MapInfoDialog open={mapInfoOpen} onOpenChange={setMapInfoOpen} viewData={viewData} />
              <MapSettingsDialog
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                mapId={mapId}
                settings={settings}
                canManage={canManage}
                capabilities={capabilities}
                systems={manageSystems}
                onImported={onBulkPaste}
                experimentalSoundMutes={
                  experimentalActive
                    ? {
                        settings: soundLayoutSettings,
                        onSettingsChange: persistSoundLayoutSettings,
                        mapSystems: viewData.systems.map((s) => ({
                          id: s.id,
                          name: s.name,
                          alias: s.alias,
                        })),
                      }
                    : undefined
                }
              />
              {capabilities.includes('audit_view') && (
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
              {experimentalActive ? (
                <MapJumpToSystemDialog
                  open={jumpPickerOpen}
                  onOpenChange={setJumpPickerOpen}
                  systems={viewData.systems}
                  onJump={jumpToMapSystem}
                />
              ) : null}
            </MapSignatureIndicatorProvider>
          </MapUnderglowProvider>
          </ExperimentalCombatRingProvider>
        </MapTravelProvider>
      </MapActiveCharProvider>
      </ExperimentalPanelGearProvider>
    </MapPresenceProvider>
    </MapLinkHoverProvider>
    </MapStyleProvider>
  );
}
