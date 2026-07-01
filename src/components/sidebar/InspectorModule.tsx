'use client';

import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { connectionTimeLeftMs } from '@/lib/map/connectionState';
import { formatRelativeFromMs } from '@/lib/map/relativeTime';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip } from '@base-ui/react/tooltip';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConnectionMassLog } from '@/components/sidebar/ConnectionMassLog';
import type {
  MapConnectionEdge,
  MapNote,
  MapSystemNode,
  MapViewData,
} from '@/types';
import type {
  UpdateConnectionBody,
  UpdateNoteBody,
  UpdateSystemBody,
} from '@/lib/map/client';
import {
  CONNECTION_SCOPES,
  EOL_STAGE_LABELS,
  EOL_STAGES,
  NOTE_SEVERITIES,
  NOTE_SEVERITY_LABELS,
  SYSTEM_STATUSES,
  WH_JUMP_MASSES,
  WH_MASSES,
  WH_MASS_LABELS,
  type ConnectionScope,
  type EolStage,
  type NoteSeverity,
  type SystemStatus,
  type WhJumpMass,
  type WhMass,
} from '@/lib/map/enumLabels';
import { systemDisplayName } from '@/lib/eve/drifterSystems';
import { NoteContent } from '@/components/map/NoteContent';
import { NOTE_TEXT_COLOR_NAMES } from '@/lib/map/noteMarkdown';
import { apertureConfig } from '../../../aperture.config';

const NONE_JUMP_MASS = '__none__';

export type SelectionRef =
  | { kind: 'system'; id: string }
  | { kind: 'connection'; id: string }
  | { kind: 'note'; id: string };

export function InspectorModule(props: {
  selected: SelectionRef | null;
  viewData: MapViewData;
  onSystemPatch: (mapSystemId: string, patch: UpdateSystemBody) => void;
  onSystemRemove: (mapSystemId: string) => void;
  onConnectionPatch: (connectionId: string, patch: UpdateConnectionBody) => void;
  onConnectionDelete: (connectionId: string) => void;
  onNotePatch: (noteId: string, patch: UpdateNoteBody) => void;
  onNoteRemove: (noteId: string) => void;
}) {
  const { selected, viewData } = props;

  if (!selected) return <EmptyInspector />;

  if (selected.kind === 'system') {
    const system = viewData.systems.find((s) => s.id === selected.id);
    if (!system) return <EmptyInspector />;
    return (
      <SystemInspector
        key={system.id}
        system={system}
        onPatch={(patch) => props.onSystemPatch(system.id, patch)}
        onRemove={() => props.onSystemRemove(system.id)}
      />
    );
  }

  if (selected.kind === 'note') {
    const note = viewData.notes.find((n) => n.id === selected.id);
    if (!note) return <EmptyInspector />;
    return (
      <NoteInspector
        key={note.id}
        note={note}
        onPatch={(patch) => props.onNotePatch(note.id, patch)}
        onRemove={() => props.onNoteRemove(note.id)}
      />
    );
  }

  const connection = viewData.connections.find((c) => c.id === selected.id);
  if (!connection) return <EmptyInspector />;
  return (
    <ConnectionInspector
      key={connection.id}
      mapId={viewData.map.id}
      connection={connection}
      onPatch={(patch) => props.onConnectionPatch(connection.id, patch)}
      onDelete={() => props.onConnectionDelete(connection.id)}
    />
  );
}

// ---------------------------------------------------------------------------
// Empty
// ---------------------------------------------------------------------------

function EmptyInspector() {
  return (
    <Card>
      <CardContent className="text-xs text-muted-foreground">
        Select a system, connection, or note to edit.
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

function SystemInspector({
  system,
  onPatch,
  onRemove,
}: {
  system: MapSystemNode;
  onPatch: (patch: UpdateSystemBody) => void;
  onRemove: () => void;
}) {
  // Local drafts seeded from the stored value, committed on blur/Enter so
  // PATCHes don't fire per keystroke. The parent renders this component with
  // `key={system.id}`, so drafts re-seed when the selected system changes.
  const [aliasDraft, setAliasDraft] = useState(system.alias ?? '');
  const [tagDraft, setTagDraft] = useState(system.tag ?? '');
  const [intelDraft, setIntelDraft] = useState(system.intelNotes ?? '');
  const displayName = systemDisplayName(system.systemId, system.name);

  return (
    <Card size="sm" className="data-[size=sm]:pb-0">
      {/* minmax(0,1fr) keeps the single grid column from re-expanding on click,
          so the title's ellipsis survives text selection / focus. */}
      <CardHeader className="grid-cols-[minmax(0,1fr)]">
        <Tooltip.Root>
          <Tooltip.Trigger
            render={<CardTitle />}
            className="block w-full cursor-text truncate text-sm select-text"
          >
            {displayName}
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner sideOffset={4} side="top" align="start">
              <Tooltip.Popup className="z-50 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md">
                {system.name}
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-xs">
        <Row label="Status">
          <Select<string>
            value={system.status}
            onValueChange={(v) => v && onPatch({ status: v as SystemStatus })}
            items={Object.fromEntries(SYSTEM_STATUSES.map((s) => [s, s]))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SYSTEM_STATUSES.map((s) => (
                <SelectItem key={s} value={s} className="capitalize">
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>

        <Row label="Alias">
          <Input
            value={aliasDraft}
            onChange={(e) => setAliasDraft(e.target.value)}
            onBlur={() => {
              const next = aliasDraft.length > 0 ? aliasDraft : null;
              if (next !== (system.alias ?? null)) onPatch({ alias: next });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            className="h-7"
            placeholder={displayName}
          />
        </Row>

        <Row label="Tag">
          <Input
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onBlur={() => {
              const next = tagDraft.length > 0 ? tagDraft : null;
              if (next !== (system.tag ?? null)) onPatch({ tag: next });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            className="h-7"
            placeholder="—"
            maxLength={50}
          />
        </Row>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-muted-foreground">Intel notes</span>
          <textarea
            value={intelDraft}
            onChange={(e) => setIntelDraft(e.target.value)}
            onBlur={() => {
              const next = intelDraft.length > 0 ? intelDraft : null;
              if (next !== (system.intelNotes ?? null)) {
                onPatch({ intelNotes: next });
              }
            }}
            placeholder="Notes are committed on blur."
            className="h-20 resize-none rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={system.locked}
              onChange={(e) => onPatch({ locked: e.target.checked })}
            />
            <span>Locked</span>
          </label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onPatch({ rallyAt: system.rallyAt ? null : new Date().toISOString() })}
          >
            {system.rallyAt ? 'Clear rally' : 'Set rally'}
          </Button>
        </div>

        {/* A locked system can't be removed — mirror the server guard so the
            button greys out with a hint to unlock it first (the Locked checkbox
            sits directly above). */}
        <div className="flex items-center justify-end gap-2">
          {system.locked && (
            <span className="text-[10px] text-muted-foreground">Unlock to remove</span>
          )}
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={onRemove}
            disabled={system.locked}
            className="gap-1.5"
          >
            <Trash2 className="size-3.5" />
            Remove
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Note
// ---------------------------------------------------------------------------

function NoteInspector({
  note,
  onPatch,
  onRemove,
}: {
  note: MapNote;
  onPatch: (patch: UpdateNoteBody) => void;
  onRemove: () => void;
}) {
  // Local drafts seeded from the stored value, committed on blur/Enter so PATCHes
  // don't fire per keystroke. The parent renders with `key={note.id}`, so drafts
  // re-seed when the selected note changes.
  const [titleDraft, setTitleDraft] = useState(note.title);
  const [contentDraft, setContentDraft] = useState(note.content ?? '');

  return (
    <Card size="sm" className="data-[size=sm]:pb-0">
      <CardHeader>
        <CardTitle className="text-sm">Note</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-xs">
        <Row label="Title">
          <Input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              const next = titleDraft.trim();
              // Title is required (it's the on-node label) — empty reverts.
              if (next.length === 0) setTitleDraft(note.title);
              else if (next !== note.title) onPatch({ title: next });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            className="h-7"
            maxLength={apertureConfig.MAP_NOTE_TITLE_MAX_LENGTH}
          />
        </Row>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-muted-foreground">Content</span>
          <textarea
            value={contentDraft}
            onChange={(e) => setContentDraft(e.target.value)}
            onBlur={() => {
              const next = contentDraft.length > 0 ? contentDraft : null;
              if (next !== (note.content ?? null)) onPatch({ content: next });
            }}
            maxLength={apertureConfig.MAP_NOTE_CONTENT_MAX_LENGTH}
            placeholder="Markdown and color tags supported."
            className="h-24 resize-none rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          <span className="text-[10px] text-muted-foreground">
            Markdown + colour tags: <code>[red]…[/red]</code> ({NOTE_TEXT_COLOR_NAMES.join(', ')})
          </span>
          {contentDraft.trim().length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-muted-foreground">Preview</span>
              <div className="rounded-md border border-border bg-background px-2 py-1 text-xs">
                <NoteContent content={contentDraft} />
              </div>
            </div>
          )}
        </div>

        <Row label="Severity">
          <Select<string>
            value={note.severity}
            onValueChange={(v) => v && onPatch({ severity: v as NoteSeverity })}
            items={Object.fromEntries(NOTE_SEVERITIES.map((s) => [s, NOTE_SEVERITY_LABELS[s]]))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NOTE_SEVERITIES.map((s) => (
                <SelectItem key={s} value={s}>
                  {NOTE_SEVERITY_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>

        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={note.locked}
            onChange={(e) => onPatch({ locked: e.target.checked })}
          />
          <span>Locked</span>
        </label>

        <div className="text-[10px] text-muted-foreground">
          Created by {note.createdByName ?? '—'} · Last edited by {note.lastEditedByName ?? '—'}
        </div>

        {/* A locked note can't be removed — mirror the server guard so the button
            greys out with a hint to unlock it first (the Locked checkbox is above). */}
        <div className="flex items-center justify-end gap-2">
          {note.locked && (
            <span className="text-[10px] text-muted-foreground">Unlock to remove</span>
          )}
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={onRemove}
            disabled={note.locked}
            className="gap-1.5"
          >
            <Trash2 className="size-3.5" />
            Remove
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

function ConnectionInspector({
  mapId,
  connection,
  onPatch,
  onDelete,
}: {
  mapId: string;
  connection: MapConnectionEdge;
  onPatch: (patch: UpdateConnectionBody) => void;
  onDelete: () => void;
}) {
  const jumpMassValue = connection.jumpMassClass ?? NONE_JUMP_MASS;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Connection</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-xs">
        <Row label="Scope">
          <Select<string>
            value={connection.scope}
            onValueChange={(v) => v && onPatch({ scope: v as ConnectionScope })}
            items={Object.fromEntries(CONNECTION_SCOPES.map((s) => [s, s]))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONNECTION_SCOPES.map((s) => (
                <SelectItem key={s} value={s} className="capitalize">
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>

        <Row label="Mass">
          <Select<string>
            value={connection.massStatus}
            onValueChange={(v) => v && onPatch({ massStatus: v as WhMass })}
            items={Object.fromEntries(WH_MASSES.map((s) => [s, s]))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WH_MASSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {WH_MASS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>

        <Row label="Jump mass">
          <Select<string>
            value={jumpMassValue}
            onValueChange={(v) =>
              onPatch({ jumpMassClass: v === NONE_JUMP_MASS ? null : (v as WhJumpMass) })
            }
            items={{
              [NONE_JUMP_MASS]: 'unknown',
              ...Object.fromEntries(WH_JUMP_MASSES.map((s) => [s, s.toUpperCase()])),
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_JUMP_MASS}>unknown</SelectItem>
              {WH_JUMP_MASSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>

        <Row label="EOL">
          <Select<string>
            value={connection.eolStage}
            onValueChange={(v) => v && onPatch({ eolStage: v as EolStage })}
            items={Object.fromEntries(EOL_STAGES.map((s) => [s, EOL_STAGE_LABELS[s]]))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EOL_STAGES.map((s) => (
                <SelectItem key={s} value={s}>
                  {EOL_STAGE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>

        <div className="grid grid-cols-2 gap-2">
          <ConnFlag
            label="Preserve mass"
            checked={connection.preserveMass}
            onChange={(v) => onPatch({ preserveMass: v })}
          />
          <ConnFlag
            label="Rolling"
            checked={connection.isRolling}
            onChange={(v) => onPatch({ isRolling: v })}
          />
        </div>

        <ConnectionExpiryHint connection={connection} />

        <ConnectionMassLog mapId={mapId} connection={connection} />

        <div className="flex justify-end">
          <Button type="button" variant="destructive" size="sm" onClick={onDelete} className="gap-1.5">
            <Trash2 className="size-3.5" />
            Delete connection
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ConnectionExpiryHint({ connection }: { connection: MapConnectionEdge }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const ms = connectionTimeLeftMs(connection, now);
  if (ms === null) return null;
  const label = connection.eolStage !== 'none' ? 'EOL expires in' : 'Expires in';
  return (
    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
      <span>{label}</span>
      <span className="font-medium tabular-nums text-foreground">{formatRelativeFromMs(ms)}</span>
    </div>
  );
}

function ConnFlag({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
