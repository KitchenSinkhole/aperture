'use client';

import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { ContextMenu } from '@base-ui/react/context-menu';
import { Plus, Radar, Scissors, StickyNote, Trash2, Unlink } from 'lucide-react';

import type {
  MapContextMenuTarget,
  MapSystemNode,
  MapConnectionEdge,
  MapNote,
} from '@/types';
import type {
  UpdateSystemBody,
  UpdateConnectionBody,
  UpdateNoteBody,
} from '@/lib/map/client';
import { computeDisconnected, computeSubchain, neighborsOf } from '@/lib/map/subchainGraph';
import {
  MenuItem,
  MenuSubmenu,
  MenuSubmenuTrigger,
  MenuSubmenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuCheckboxItem,
  MenuSeparator,
} from '@/components/ui/menu';
import {
  SYSTEM_STATUSES,
  WH_MASSES,
  WH_JUMP_MASSES,
  CONNECTION_SCOPES,
  EOL_STAGES,
  EOL_STAGE_LABELS,
  WH_MASS_LABELS,
  NOTE_SEVERITIES,
  NOTE_SEVERITY_LABELS,
  type SystemStatus,
  type WhMass,
  type WhJumpMass,
  type ConnectionScope,
  type EolStage,
  type NoteSeverity,
} from '@/lib/map/enumLabels';
import { cn } from '@/lib/utils';
import { SetDestinationItem } from './SetDestinationItem';

/** Sentinel radio value for "jump mass unknown" — mirrors `InspectorModule.tsx`. */
const NONE_JUMP_MASS = '__none__';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Human label for a system in menus: its alias when set, else the solar-system name. */
const systemLabel = (s: MapSystemNode) => s.alias?.trim() || s.name;

/** Display labels of every locked system among `ids` — drives the delete-block hints. */
function lockedLabels(byId: Map<string, MapSystemNode>, ids: Iterable<string>): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const s = byId.get(id);
    if (s?.locked) out.push(systemLabel(s));
  }
  return out;
}

/** Hint naming which locked system(s) block a delete. Assumes `names.length > 0`. */
function formatLockedHint(names: string[]): string {
  if (names.length === 1) return `${names[0]} is locked — unlock it to delete`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are locked — unlock to delete`;
  return `${names[0]} and ${names.length - 1} more are locked — unlock to delete`;
}

/**
 * A greyed-out (non-interactive) menu row whose second line explains why the
 * action is blocked — used to surface the locked-system delete guard so the user
 * knows which system to unlock first instead of hitting a server rejection.
 */
function DisabledHintItem({
  icon,
  inset,
  label,
  hint,
  destructive,
}: {
  icon?: React.ReactNode;
  inset?: boolean;
  label: string;
  hint: string;
  destructive?: boolean;
}) {
  return (
    <MenuItem
      disabled
      icon={icon}
      inset={inset}
      className={cn('flex-col items-start gap-0.5', destructive && 'text-destructive')}
    >
      <span>{label}</span>
      <span className="text-[10px] leading-tight font-normal text-muted-foreground">{hint}</span>
    </MenuItem>
  );
}

/**
 * Controlled, cursor-anchored context menu for the map canvas. Driven entirely
 * by `target`: when non-null the menu opens, anchored to the stored client x/y
 * via a virtual anchor element. Real per-kind items are built in `renderItems`,
 * resolving the target row from `systems`/`connections`; every leaf action calls
 * its callback and then `onClose()`. No text-input actions live here — those
 * stay in the inspector sidebar.
 */
export function MapContextMenu({
  target,
  onClose,
  systems,
  connections,
  homeMapSystemId,
  selectedSystemIds,
  onSystemPatch,
  onSystemRemove,
  onSystemRemoveSelected,
  onConnectionPatch,
  onConnectionDelete,
  onAddSystemAt,
  onDeleteSubchain,
  onDeleteSubchainPick,
  onDeleteDisconnected,
  onPingSystem,
  notes,
  onAddNoteAt,
  onNotePatch,
  onNoteRemove,
}: {
  target: MapContextMenuTarget | null;
  onClose: () => void;
  systems: MapSystemNode[];
  connections: MapConnectionEdge[];
  /** `ap_map_system.id` of the designated Home, or null. Drives the subchain anchor. */
  homeMapSystemId: string | null;
  /** Current multi-selection. When the right-clicked system is in here, "Remove
      from map" acts on the whole group via `onSystemRemoveSelected`. */
  selectedSystemIds: Set<string>;
  onSystemPatch: (id: string, patch: UpdateSystemBody) => void;
  onSystemRemove: (id: string) => void;
  /** Removes the entire current multi-selection (mirrors the Delete key). */
  onSystemRemoveSelected: () => void;
  onConnectionPatch: (id: string, patch: UpdateConnectionBody) => void;
  onConnectionDelete: (id: string) => void;
  onAddSystemAt: (clientX: number, clientY: number) => void;
  /** Home-anchored: delete this head system + its branch (Home is the keep-side). */
  onDeleteSubchain: (headId: string) => void;
  /** No-Home fallback: delete this head, keeping the chosen neighbour's side. */
  onDeleteSubchainPick: (headId: string, anchorId: string) => void;
  /** Pane action: delete every system disconnected from the Home. */
  onDeleteDisconnected: () => void;
  /** Broadcast a transient attention "ping" pulse on this system to all viewers. */
  onPingSystem: (id: string) => void;
  /** Live notes — the `note` target resolves its row from here. */
  notes: MapNote[];
  /** Pane action: create a note at the right-clicked point. */
  onAddNoteAt: (clientX: number, clientY: number) => void;
  onNotePatch: (id: string, patch: UpdateNoteBody) => void;
  onNoteRemove: (id: string) => void;
}) {
  // A zero-size virtual element at the cursor point; recreated per render so the
  // rect tracks the current target's coordinates.
  const anchor = target
    ? {
        getBoundingClientRect: () =>
          ({
            x: target.x,
            y: target.y,
            width: 0,
            height: 0,
            top: target.y,
            left: target.x,
            right: target.x,
            bottom: target.y,
          }) as DOMRect,
      }
    : null;

  return (
    // `ContextMenu.Root` (not raw `Menu.Root`) so the menu runs in Base UI's
    // context-menu mode: it sets `parent.type === 'context-menu'`, which gates
    // the open/dismiss lifecycle (outside-press grace period, `allowMouseEnter`
    // for submenu hover). A raw `Menu.Root` stays in dropdown mode and tears
    // itself down the instant submenu hover machinery engages — which is why the
    // submenu-bearing system/connection menus collapsed on pointer move while the
    // submenu-free pane menu survived. We still drive `open` + positioning
    // ourselves via the virtual anchor; the right-click target lives in `target`.
    <ContextMenu.Root
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner
          anchor={anchor}
          side="right"
          align="start"
          className="z-50 outline-none"
        >
          <MenuPrimitive.Popup
            data-slot="map-context-menu"
            className={cn(
              'min-w-40 overflow-hidden rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md transition duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0',
            )}
          >
            {renderItems({
              target,
              onClose,
              systems,
              connections,
              homeMapSystemId,
              selectedSystemIds,
              onSystemPatch,
              onSystemRemove,
              onSystemRemoveSelected,
              onConnectionPatch,
              onConnectionDelete,
              onAddSystemAt,
              onDeleteSubchain,
              onDeleteSubchainPick,
              onDeleteDisconnected,
              onPingSystem,
              notes,
              onAddNoteAt,
              onNotePatch,
              onNoteRemove,
            })}
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </ContextMenu.Root>
  );
}

function renderItems({
  target,
  onClose,
  systems,
  connections,
  homeMapSystemId,
  selectedSystemIds,
  onSystemPatch,
  onSystemRemove,
  onSystemRemoveSelected,
  onConnectionPatch,
  onConnectionDelete,
  onAddSystemAt,
  onDeleteSubchain,
  onDeleteSubchainPick,
  onDeleteDisconnected,
  onPingSystem,
  notes,
  onAddNoteAt,
  onNotePatch,
  onNoteRemove,
}: {
  target: MapContextMenuTarget | null;
  onClose: () => void;
  systems: MapSystemNode[];
  connections: MapConnectionEdge[];
  homeMapSystemId: string | null;
  selectedSystemIds: Set<string>;
  onSystemPatch: (id: string, patch: UpdateSystemBody) => void;
  onSystemRemove: (id: string) => void;
  onSystemRemoveSelected: () => void;
  onConnectionPatch: (id: string, patch: UpdateConnectionBody) => void;
  onConnectionDelete: (id: string) => void;
  onAddSystemAt: (clientX: number, clientY: number) => void;
  onDeleteSubchain: (headId: string) => void;
  onDeleteSubchainPick: (headId: string, anchorId: string) => void;
  onDeleteDisconnected: () => void;
  onPingSystem: (id: string) => void;
  notes: MapNote[];
  onAddNoteAt: (clientX: number, clientY: number) => void;
  onNotePatch: (id: string, patch: UpdateNoteBody) => void;
  onNoteRemove: (id: string) => void;
}) {
  if (!target) return null;

  switch (target.kind) {
    case 'system': {
      const system = systems.find((s) => s.id === target.id);
      if (!system) return <MenuItem disabled>System not found</MenuItem>;
      // Right-clicking a system that's part of the current multi-selection makes
      // "Remove from map" act on the whole group; right-clicking outside the
      // selection removes only that one (selection is left untouched on r-click).
      const inSelection = selectedSystemIds.size > 1 && selectedSystemIds.has(system.id);
      return (
        <SystemItems
          system={system}
          systems={systems}
          connections={connections}
          homeMapSystemId={homeMapSystemId}
          inSelection={inSelection}
          selectedSystemIds={selectedSystemIds}
          onClose={onClose}
          onPatch={(patch) => {
            onSystemPatch(system.id, patch);
            onClose();
          }}
          onRemove={() => {
            if (inSelection) onSystemRemoveSelected();
            else onSystemRemove(system.id);
            onClose();
          }}
          onDeleteSubchain={() => {
            onDeleteSubchain(system.id);
            onClose();
          }}
          onDeleteSubchainPick={(anchorId) => {
            onDeleteSubchainPick(system.id, anchorId);
            onClose();
          }}
          onPing={() => {
            onPingSystem(system.id);
            onClose();
          }}
        />
      );
    }
    case 'note': {
      const note = notes.find((n) => n.id === target.id);
      if (!note) return <MenuItem disabled>Note not found</MenuItem>;
      return (
        <NoteItems
          note={note}
          onPatch={(patch) => {
            onNotePatch(note.id, patch);
            onClose();
          }}
          onDelete={() => {
            onNoteRemove(note.id);
            onClose();
          }}
        />
      );
    }
    case 'connection': {
      const connection = connections.find((c) => c.id === target.id);
      if (!connection) return <MenuItem disabled>Connection not found</MenuItem>;
      return (
        <ConnectionItems
          connection={connection}
          onPatch={(patch) => {
            onConnectionPatch(connection.id, patch);
            onClose();
          }}
          onDelete={() => {
            onConnectionDelete(connection.id);
            onClose();
          }}
        />
      );
    }
    case 'pane': {
      // "Delete disconnected" needs a Home to measure against and at least one
      // system actually cut off from it — otherwise the action is a no-op, so
      // hide it.
      const disconnected =
        homeMapSystemId !== null
          ? computeDisconnected({ systems, connections, homeId: homeMapSystemId })
          : new Set<string>();
      const byId = new Map(systems.map((s) => [s.id, s]));
      const lockedDisconnected = lockedLabels(byId, disconnected);
      return (
        <>
          <MenuItem
            icon={<Plus className="size-3.5" />}
            onClick={() => {
              onAddSystemAt(target.x, target.y);
              onClose();
            }}
          >
            Add system
          </MenuItem>
          <MenuItem
            icon={<StickyNote className="size-3.5" />}
            onClick={() => {
              onAddNoteAt(target.x, target.y);
              onClose();
            }}
          >
            Add note here
          </MenuItem>
          {disconnected.size > 0 &&
            (lockedDisconnected.length > 0 ? (
              // A locked system anywhere in the disconnected set blocks the whole
              // delete (the server rolls the batch back), so grey it out here.
              <DisabledHintItem
                destructive
                icon={<Unlink className="size-3.5" />}
                label="Delete disconnected"
                hint={formatLockedHint(lockedDisconnected)}
              />
            ) : (
              <MenuItem
                className="text-destructive data-highlighted:text-destructive"
                icon={<Unlink className="size-3.5" />}
                onClick={() => {
                  onDeleteDisconnected();
                  onClose();
                }}
              >
                Delete disconnected
              </MenuItem>
            ))}
        </>
      );
    }
  }
}

function SystemItems({
  system,
  systems,
  connections,
  homeMapSystemId,
  inSelection,
  selectedSystemIds,
  onPatch,
  onRemove,
  onDeleteSubchain,
  onDeleteSubchainPick,
  onPing,
  onClose,
}: {
  system: MapSystemNode;
  systems: MapSystemNode[];
  connections: MapConnectionEdge[];
  /** `ap_map_system.id` of the designated Home, or null. */
  homeMapSystemId: string | null;
  /** The right-clicked system is part of the current multi-selection (⇒ group remove). */
  inSelection: boolean;
  selectedSystemIds: Set<string>;
  onPatch: (patch: UpdateSystemBody) => void;
  onRemove: () => void;
  onDeleteSubchain: () => void;
  onDeleteSubchainPick: (anchorId: string) => void;
  onPing: () => void;
  /** Dismiss the menu — "Set destination" closes it itself (self-contained action). */
  onClose: () => void;
}) {
  const isHome = homeMapSystemId === system.id;
  const hasHome = homeMapSystemId !== null;
  const byId = new Map(systems.map((s) => [s.id, s]));

  // "Remove from map" target set: the whole selection when right-clicked inside
  // it, else just this system. Locked systems (and the Home) can't be removed —
  // mirror the server guard so the menu blocks/greys rather than failing on the
  // round-trip. The group path silently skips them; a lone locked system greys
  // the whole item.
  const removeIds = inSelection ? [...selectedSystemIds] : [system.id];
  const lockedRemove = lockedLabels(byId, removeIds);
  const deletableRemoveCount = removeIds.filter((id) => {
    const s = byId.get(id);
    return !!s && !s.locked && id !== homeMapSystemId;
  }).length;

  // Delete-subchain locked guard: a locked system anywhere in the doomed branch
  // blocks the whole delete (the server rolls the batch back), so resolve the
  // Home-anchored subchain up front and grey the item when it traps a lock.
  const homeSubchain =
    hasHome && !isHome
      ? computeSubchain({ systems, connections, headId: system.id, anchorId: homeMapSystemId })
      : null;
  const subchainLocked = homeSubchain ? lockedLabels(byId, homeSubchain) : [];

  return (
    <>
      <MenuItem icon={<Radar className="size-3.5" />} onClick={onPing}>
        Ping
      </MenuItem>

      <SetDestinationItem system={system} onClose={onClose} />

      <MenuSubmenu>
        <MenuSubmenuTrigger inset>Status</MenuSubmenuTrigger>
        <MenuSubmenuContent>
          <MenuRadioGroup
            value={system.status}
            onValueChange={(v) => onPatch({ status: v as SystemStatus })}
          >
            {SYSTEM_STATUSES.map((s) => (
              <MenuRadioItem key={s} value={s}>
                {capitalize(s)}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuSubmenuContent>
      </MenuSubmenu>

      <MenuItem
        inset
        onClick={() =>
          onPatch({ rallyAt: system.rallyAt ? null : new Date().toISOString() })
        }
      >
        {system.rallyAt ? 'Clear rally' : 'Set rally'}
      </MenuItem>

      <MenuCheckboxItem
        checked={system.locked}
        onCheckedChange={(checked) => onPatch({ locked: checked })}
      >
        Locked
      </MenuCheckboxItem>

      <MenuSeparator />

      {/* Remove from map: greyed when nothing in the target set can go (a lone
          locked system, or a selection of only locked/Home systems). A mixed
          selection removes the deletable ones and notes how many locks it skips. */}
      {deletableRemoveCount === 0 ? (
        <DisabledHintItem
          destructive
          icon={<Trash2 className="size-3.5" />}
          label="Remove from map"
          hint={
            lockedRemove.length > 0
              ? formatLockedHint(lockedRemove)
              : isHome
                ? 'The Home system can’t be removed — clear Home in map settings'
                : 'Nothing here can be removed'
          }
        />
      ) : (
        <MenuItem
          className="text-destructive data-highlighted:text-destructive"
          icon={<Trash2 className="size-3.5" />}
          onClick={onRemove}
        >
          {inSelection ? `Remove ${deletableRemoveCount} from map` : 'Remove from map'}
          {inSelection && lockedRemove.length > 0 && (
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
              ({lockedRemove.length} locked)
            </span>
          )}
        </MenuItem>
      )}

      {/* Delete subchain: hidden for the Home node (it can't be a head). With a
          Home set it's a single click (Home is the keep-side); otherwise the
          user picks which neighbour to keep. Greyed when a locked system sits in
          the doomed branch. */}
      {!isHome &&
        (hasHome ? (
          subchainLocked.length > 0 ? (
            <DisabledHintItem
              destructive
              icon={<Scissors className="size-3.5" />}
              label="Delete subchain"
              hint={formatLockedHint(subchainLocked)}
            />
          ) : (
            <MenuItem
              className="text-destructive data-highlighted:text-destructive"
              icon={<Scissors className="size-3.5" />}
              onClick={onDeleteSubchain}
            >
              Delete subchain
            </MenuItem>
          )
        ) : (
          <SubchainKeepSubmenu
            system={system}
            systems={systems}
            connections={connections}
            onPick={onDeleteSubchainPick}
          />
        ))}
    </>
  );
}

/**
 * No-Home fallback: a submenu listing the head's neighbours so the user picks
 * which side to KEEP. That neighbour becomes the anchor; the head and the rest
 * of its branch are deleted. Disabled when the head has no connections.
 */
function SubchainKeepSubmenu({
  system,
  systems,
  connections,
  onPick,
}: {
  system: MapSystemNode;
  systems: MapSystemNode[];
  connections: MapConnectionEdge[];
  onPick: (anchorId: string) => void;
}) {
  const neighbourIds = neighborsOf(connections, system.id);
  if (neighbourIds.length === 0) {
    return (
      <MenuItem inset disabled>
        Delete subchain
      </MenuItem>
    );
  }
  const byId = new Map(systems.map((s) => [s.id, s]));
  return (
    <MenuSubmenu>
      <MenuSubmenuTrigger inset>Delete subchain</MenuSubmenuTrigger>
      <MenuSubmenuContent>
        {neighbourIds.map((id) => {
          const neighbour = byId.get(id);
          const label = `Keep ${neighbour ? systemLabel(neighbour) : id}`;
          // Each keep-side choice yields a different doomed set; grey the ones
          // whose branch traps a locked system (the server would reject them).
          const locked = lockedLabels(
            byId,
            computeSubchain({ systems, connections, headId: system.id, anchorId: id }),
          );
          if (locked.length > 0) {
            return <DisabledHintItem key={id} label={label} hint={formatLockedHint(locked)} />;
          }
          return (
            <MenuItem key={id} onClick={() => onPick(id)}>
              {label}
            </MenuItem>
          );
        })}
      </MenuSubmenuContent>
    </MenuSubmenu>
  );
}

function NoteItems({
  note,
  onPatch,
  onDelete,
}: {
  note: MapNote;
  onPatch: (patch: UpdateNoteBody) => void;
  onDelete: () => void;
}) {
  return (
    <>
      <MenuSubmenu>
        <MenuSubmenuTrigger inset>Severity</MenuSubmenuTrigger>
        <MenuSubmenuContent>
          <MenuRadioGroup
            value={note.severity}
            onValueChange={(v) => onPatch({ severity: v as NoteSeverity })}
          >
            {NOTE_SEVERITIES.map((s) => (
              <MenuRadioItem key={s} value={s}>
                {NOTE_SEVERITY_LABELS[s]}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuSubmenuContent>
      </MenuSubmenu>

      <MenuCheckboxItem
        checked={note.locked}
        onCheckedChange={(checked) => onPatch({ locked: checked })}
      >
        Locked
      </MenuCheckboxItem>

      <MenuSeparator />

      {/* A locked note is protected from deletion (the lock also blocks dragging);
          unlock it first. Mirrors the inspector's disabled Remove button. */}
      {note.locked ? (
        <DisabledHintItem
          destructive
          icon={<Trash2 className="size-3.5" />}
          label="Delete note"
          hint="Unlock the note to delete it"
        />
      ) : (
        <MenuItem
          className="text-destructive data-highlighted:text-destructive"
          icon={<Trash2 className="size-3.5" />}
          onClick={onDelete}
        >
          Delete note
        </MenuItem>
      )}
    </>
  );
}

function ConnectionItems({
  connection,
  onPatch,
  onDelete,
}: {
  connection: MapConnectionEdge;
  onPatch: (patch: UpdateConnectionBody) => void;
  onDelete: () => void;
}) {
  return (
    <>
      <MenuSubmenu>
        <MenuSubmenuTrigger inset>Mass</MenuSubmenuTrigger>
        <MenuSubmenuContent>
          <MenuRadioGroup
            value={connection.massStatus}
            onValueChange={(v) => onPatch({ massStatus: v as WhMass })}
          >
            {WH_MASSES.map((m) => (
              <MenuRadioItem key={m} value={m}>
                {WH_MASS_LABELS[m]}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuSubmenuContent>
      </MenuSubmenu>

      <MenuSubmenu>
        <MenuSubmenuTrigger inset>Jump mass</MenuSubmenuTrigger>
        <MenuSubmenuContent>
          <MenuRadioGroup
            value={connection.jumpMassClass ?? NONE_JUMP_MASS}
            onValueChange={(v) =>
              onPatch({ jumpMassClass: v === NONE_JUMP_MASS ? null : (v as WhJumpMass) })
            }
          >
            <MenuRadioItem value={NONE_JUMP_MASS}>unknown</MenuRadioItem>
            {WH_JUMP_MASSES.map((m) => (
              <MenuRadioItem key={m} value={m}>
                {m.toUpperCase()}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuSubmenuContent>
      </MenuSubmenu>

      <MenuSubmenu>
        <MenuSubmenuTrigger inset>Type</MenuSubmenuTrigger>
        <MenuSubmenuContent>
          <MenuRadioGroup
            value={connection.scope}
            onValueChange={(v) => onPatch({ scope: v as ConnectionScope })}
          >
            {CONNECTION_SCOPES.map((s) => (
              <MenuRadioItem key={s} value={s}>
                {capitalize(s)}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuSubmenuContent>
      </MenuSubmenu>

      <MenuSubmenu>
        <MenuSubmenuTrigger inset>EOL</MenuSubmenuTrigger>
        <MenuSubmenuContent>
          <MenuRadioGroup
            value={connection.eolStage}
            onValueChange={(v) => onPatch({ eolStage: v as EolStage })}
          >
            {EOL_STAGES.map((s) => (
              <MenuRadioItem key={s} value={s}>
                {EOL_STAGE_LABELS[s]}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuSubmenuContent>
      </MenuSubmenu>

      <MenuCheckboxItem
        checked={connection.preserveMass}
        onCheckedChange={(checked) => onPatch({ preserveMass: checked })}
      >
        Preserve mass
      </MenuCheckboxItem>

      <MenuCheckboxItem
        checked={connection.isRolling}
        onCheckedChange={(checked) => onPatch({ isRolling: checked })}
      >
        Rolling
      </MenuCheckboxItem>

      <MenuCheckboxItem
        checked={connection.isStatic}
        onCheckedChange={(checked) => onPatch({ isStatic: checked })}
      >
        Static
      </MenuCheckboxItem>

      <MenuSeparator />

      <MenuItem
        className="text-destructive data-highlighted:text-destructive"
        icon={<Trash2 className="size-3.5" />}
        onClick={onDelete}
      >
        Delete connection
      </MenuItem>
    </>
  );
}
