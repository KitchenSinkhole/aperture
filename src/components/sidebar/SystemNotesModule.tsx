'use client';

import { useMemo, useState } from 'react';
import { Lock, LockOpen, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { NoteContent } from '@/components/map/NoteContent';
import { NOTE_TEXT_COLOR_NAMES } from '@/lib/map/noteMarkdown';
import { IntelScopeChip, intelScopeAudience } from './IntelScopeChip';
import { SystemNotesBrowserDialog } from './SystemNotesBrowserDialog';
import { formatAgoFromMs } from '@/lib/map/relativeTime';
import { cn } from '@/lib/utils';
import type { UpdateSystemNoteBody } from '@/lib/system-notes/client';
import type {
  MapSystemNode,
  MapType,
  SystemNote,
  SystemNoteCategoryDef,
  SystemNoteChipColor,
} from '@/types';

export type SystemNoteFormValues = {
  body: string;
  category: string | null;
  locked: boolean;
};

/**
 * The fixed chip palette. Deliberately closed and spelled out as full literal
 * class strings so Tailwind's scanner keeps every colour available regardless
 * of which ones the deployment's vocabulary picks. The vocabulary's `color`
 * keys (`SYSTEM_NOTE_CHIP_COLORS`) index this record.
 */
const CHIP_PALETTE: Record<SystemNoteChipColor, string> = {
  sky: 'bg-sky-500/15 text-sky-500 ring-sky-500/30',
  violet: 'bg-violet-500/15 text-violet-500 ring-violet-500/30',
  emerald: 'bg-emerald-500/15 text-emerald-500 ring-emerald-500/30',
  amber: 'bg-amber-500/15 text-amber-500 ring-amber-500/30',
  red: 'bg-red-500/15 text-red-500 ring-red-500/30',
  orange: 'bg-orange-500/15 text-orange-500 ring-orange-500/30',
  blue: 'bg-blue-500/15 text-blue-500 ring-blue-500/30',
  cyan: 'bg-cyan-500/15 text-cyan-500 ring-cyan-500/30',
  pink: 'bg-pink-500/15 text-pink-500 ring-pink-500/30',
  gray: 'bg-gray-500/15 text-gray-500 ring-gray-500/30',
};

function chipClasses(categoryKey: string, categories: SystemNoteCategoryDef[]): string {
  const def = categories.find((c) => c.key === categoryKey);
  // A key absent from the current vocabulary (edited by an admin) stays
  // legible as a neutral chip.
  return def ? CHIP_PALETTE[def.color] : CHIP_PALETTE.gray;
}

export function CategoryChip({
  category,
  categories,
  className,
}: {
  category: string;
  /** The deployment's vocabulary (`ap_instance.system_note_categories`). */
  categories: SystemNoteCategoryDef[];
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-1.5 py-px text-[10px] font-medium capitalize ring-1',
        chipClasses(category, categories),
        className,
      )}
    >
      {category}
    </span>
  );
}

/** What a new note's audience will be, said in terms of the map it lands on. */
const NEW_SCOPE_AUDIENCE: Record<MapType, string> = {
  private: 'Saved on a private map, so only that map’s owner will see it.',
  corp: 'Saved on a corp map, so that corporation’s members will see it.',
  alliance: 'Saved on an alliance map, so that alliance’s members will see it.',
};

/**
 * Sidebar module for global system notes on the selected system. Lists notes
 * newest first (bodies render as markdown), each carrying its scope chip and an
 * optional category chip, with a category filter row, per-note lock toggle,
 * add/edit/delete, and a notes browser behind the search button. Notes are
 * keyed on the static system (not the map), so intel written here is readable
 * from every map whenever the system is encountered again. A row's audience is
 * its own `scope`, which need not match the open map: the read filter follows
 * the viewer, so a member on a corp map also sees their alliance's rows and
 * their own private ones side by side (see `src/lib/system-notes/read.ts`).
 *
 * Inert when `enabled` is false — the whole feature belongs to the entity that
 * owns the map, so a guest gets an explanation instead of a list and no way to
 * add a row the server would refuse.
 *
 * Not realtime-synced — another user's edits show on the next page load.
 */
export function SystemNotesModule({
  system,
  notes,
  categories,
  enabled,
  mapType,
  onCreate,
  onPatch,
  onDelete,
  onJumpToSystem,
}: {
  system: MapSystemNode | null;
  notes: SystemNote[];
  /** The deployment's category vocabulary (`ap_instance.system_note_categories`). */
  categories: SystemNoteCategoryDef[];
  /** Whether the viewer belongs to the map's owning entity; false disables the module. */
  enabled: boolean;
  /** The open map's type; a new note's scope is derived from it server-side. */
  mapType: MapType;
  onCreate: (values: SystemNoteFormValues) => void;
  onPatch: (noteId: string, patch: UpdateSystemNoteBody) => void;
  onDelete: (noteId: string) => void;
  /** Focus a system on the current map by EVE system id (from the browser). */
  onJumpToSystem: (systemId: number) => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [editing, setEditing] = useState<SystemNote | null>(null);
  const [filter, setFilter] = useState<string | null>(null);

  // A filter chosen on one system must not silently hide another system's
  // notes behind a chip that is no longer rendered. Reset during render (not
  // in an effect) so the switched-to system never paints filtered.
  const [filterSystemId, setFilterSystemId] = useState(system?.systemId ?? null);
  if (filterSystemId !== (system?.systemId ?? null)) {
    setFilterSystemId(system?.systemId ?? null);
    setFilter(null);
  }

  // Only offer filter chips for categories actually present — vocabulary order
  // first, then any keys the current vocabulary no longer lists (neutral chips).
  const presentCategories = useMemo(() => {
    const present = new Set(notes.map((n) => n.category).filter((c): c is string => c !== null));
    const known = categories.map((c) => c.key).filter((k) => present.has(k));
    const unknown = [...present].filter((k) => !categories.some((c) => c.key === k)).sort();
    return [...known, ...unknown];
  }, [notes, categories]);
  const visible = filter ? notes.filter((n) => n.category === filter) : notes;

  function openAdd() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(note: SystemNote) {
    setEditing(note);
    setDialogOpen(true);
  }

  function onSubmit(values: SystemNoteFormValues) {
    if (editing) onPatch(editing.id, values);
    else onCreate(values);
  }

  if (!enabled) {
    return (
      <Card size="sm">
        <CardContent className="text-xs text-muted-foreground">
          System notes belong to the corporation or alliance that owns this map, so they are not
          available to guests on it.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card size="sm">
      <CardHeader className="flex flex-row items-center justify-end gap-1">
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Search all system notes"
          onClick={() => setBrowserOpen(true)}
        >
          <Search className="size-3" />
        </Button>
        {system ? (
          <Button size="xs" variant="outline" className="gap-1" onClick={openAdd}>
            <Plus className="size-3" />
            Add
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-xs">
        {presentCategories.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setFilter(null)}
              className={cn(
                'rounded-full px-1.5 py-px text-[10px] font-medium ring-1 ring-border',
                filter === null ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
              )}
            >
              All
            </button>
            {presentCategories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setFilter(filter === c ? null : c)}
                className={cn(filter === c ? '' : 'opacity-60 hover:opacity-100')}
              >
                <CategoryChip category={c} categories={categories} />
              </button>
            ))}
          </div>
        ) : null}
        {!system ? (
          <p className="text-muted-foreground">Select a system to see its notes.</p>
        ) : visible.length === 0 ? (
          <p className="text-muted-foreground">
            {notes.length === 0 ? 'No notes recorded.' : 'No notes in this category.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.map((n) => (
              <li key={n.id} className="rounded border border-border p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-center gap-1">
                      <IntelScopeChip scope={n.scope} />
                      {n.category ? (
                        <CategoryChip category={n.category} categories={categories} />
                      ) : null}
                    </span>
                    <NoteContent content={n.body} className="text-foreground" />
                    <span className="text-[10px] text-muted-foreground">
                      {n.createdByName ? `${n.createdByName} · ` : ''}
                      {relativeTime(n.createdAt)}
                      {n.lastEditedByName && n.updatedAt !== n.createdAt
                        ? ` · edited by ${n.lastEditedByName} ${relativeTime(n.updatedAt)}`
                        : ''}
                    </span>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={n.locked ? 'Unlock note' : 'Lock note'}
                      onClick={() => onPatch(n.id, { locked: !n.locked })}
                    >
                      {n.locked ? (
                        <Lock className="size-3 text-amber-500" />
                      ) : (
                        <LockOpen className="size-3" />
                      )}
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Edit note"
                      disabled={n.locked}
                      onClick={() => openEdit(n)}
                    >
                      <Pencil className="size-3" />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Delete note"
                      disabled={n.locked}
                      onClick={() => onDelete(n.id)}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {system ? (
        <SystemNoteDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          systemName={system.alias?.trim() || system.name}
          mapType={mapType}
          categories={categories}
          initial={editing ?? undefined}
          onSubmit={onSubmit}
        />
      ) : null}
      <SystemNotesBrowserDialog
        open={browserOpen}
        onOpenChange={setBrowserOpen}
        categories={categories}
        onJumpToSystem={(systemId) => {
          setBrowserOpen(false);
          onJumpToSystem(systemId);
        }}
      />
    </Card>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  return formatAgoFromMs(Date.now() - then, 'long');
}

/** Create/edit dialog for a global system note. `initial` present ⇒ edit mode. */
function SystemNoteDialog({
  open,
  onOpenChange,
  systemName,
  mapType,
  categories,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  systemName: string;
  /** The open map's type; a new note's scope is derived from it server-side. */
  mapType: MapType;
  categories: SystemNoteCategoryDef[];
  initial?: SystemNote;
  onSubmit: (values: SystemNoteFormValues) => void;
}) {
  // An edit keeps the row's own scope, which need not be the open map's.
  const scope = initial ? initial.scope : mapType;
  const audience = initial ? intelScopeAudience(initial.scope) : NEW_SCOPE_AUDIENCE[mapType];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit note' : 'Add note'}</DialogTitle>
          <DialogDescription>
            Note for {systemName} — visible from every map showing it.
          </DialogDescription>
        </DialogHeader>

        {/* Audience before submit: the failure mode is writing staging intel
            believing it is private. Scope is derived, never picked. */}
        <p className="flex items-start gap-2 rounded border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
          <IntelScopeChip scope={scope} className="mt-0.5" />
          <span>{audience}</span>
        </p>

        {/* The dialog popup unmounts on close, so NoteForm remounts (and re-seeds
            from `initial`) on each open. */}
        {open ? (
          <NoteForm
            categories={categories}
            initial={initial}
            onSubmit={(values) => {
              onSubmit(values);
              onOpenChange(false);
            }}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

const NO_CATEGORY = 'none';

function NoteForm({
  categories,
  initial,
  onSubmit,
  onCancel,
}: {
  categories: SystemNoteCategoryDef[];
  initial?: SystemNote;
  onSubmit: (values: SystemNoteFormValues) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState(initial?.body ?? '');
  // A stored key the current vocabulary no longer lists can't be offered by the
  // Select (and the server would reject it); it coerces to None, so saving
  // visibly clears the legacy category rather than 400ing.
  const [category, setCategory] = useState<string>(() => {
    const c = initial?.category;
    return c && categories.some((d) => d.key === c) ? c : NO_CATEGORY;
  });
  const [locked, setLocked] = useState(initial?.locked ?? false);
  const trimmed = body.trim();

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!trimmed) return;
        onSubmit({
          body: trimmed,
          category: category === NO_CATEGORY ? null : category,
          locked,
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="system-note-category" className="text-sm font-medium">
          Category
        </label>
        <Select value={category} onValueChange={(v) => setCategory(v ?? NO_CATEGORY)}>
          <SelectTrigger id="system-note-category" className="w-40 capitalize">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_CATEGORY}>None</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.key} value={c.key} className="capitalize">
                {c.key}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="system-note-body" className="text-sm font-medium">
          Note
        </label>
        <textarea
          id="system-note-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Good farm hole, active locals in EU time, watch the C5 static…"
          rows={5}
          maxLength={2000}
          autoFocus
          className="rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <p className="text-[10px] text-muted-foreground">
          Markdown supported (bold, lists, links, headings), plus colour tags:{' '}
          {NOTE_TEXT_COLOR_NAMES.map((name) => `[${name}]`).join(' ')}
        </p>
      </div>
      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} />
        <span>Locked</span>
      </label>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!trimmed}>
          {initial ? 'Save' : 'Add note'}
        </Button>
      </DialogFooter>
    </form>
  );
}
