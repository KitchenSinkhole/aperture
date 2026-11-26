'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { ClipboardPaste, Plus, Pencil, Trash2, HelpCircle, Link2Off } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { parseSignaturePaste } from '@/lib/map/signatureParser';
import { resolveSignaturesOnServer } from '@/lib/map/client';
import { applySignaturePaste } from '@/lib/map/applySignaturePaste';
import type {
  BulkPasteOptions,
  MapEventPayload,
  MapSignature,
  ResolvedSigRow,
} from '@/types';

const PREVIEW_DEBOUNCE_MS = 300;

type RowStatus = 'new' | 'update' | 'unchanged' | 'unresolvable';

type PreviewRow = ResolvedSigRow & { status: RowStatus };

const DEFAULT_OPTIONS: BulkPasteOptions = {
  addMissing: true,
  updateExisting: true,
  removeMissing: false,
  removeOrphanedConnections: false,
};

export function SignaturePasteDialog({
  open,
  onOpenChange,
  mapId,
  mapSystemId,
  existingSigs,
  onResult,
  initialText,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mapId: string;
  mapSystemId: string;
  existingSigs: MapSignature[];
  onResult: (payloads: MapEventPayload[]) => void;
  /** Seeds the textarea when opened from Ctrl+V preview (experimental). */
  initialText?: string;
}) {
  const [text, setText] = useState('');
  const [resolved, setResolved] = useState<ResolvedSigRow[]>([]);
  const [options, setOptions] = useState<BulkPasteOptions>(DEFAULT_OPTIONS);
  const [pending, startTransition] = useTransition();
  const resolveSeq = useRef(0);

  const parsed = useMemo(() => parseSignaturePaste(text), [text]);

  // Debounced server-side resolve for the preview. The effect body only
  // schedules and clears a timeout; setState happens inside the async
  // callback (allowed under react-hooks/set-state-in-effect).
  useEffect(() => {
    if (parsed.length === 0) return;
    const seq = ++resolveSeq.current;
    const handle = window.setTimeout(async () => {
      const result = await resolveSignaturesOnServer({ mapId, rows: parsed });
      if (seq !== resolveSeq.current) return; // a newer paste superseded this
      if (result.ok) setResolved(result.data);
    }, PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [parsed, mapId]);

  // Reset on close — wrap `onOpenChange` rather than mirroring `open` in an
  // effect (avoids the cascading-render anti-pattern).
  function handleOpenChange(next: boolean) {
    if (next && initialText) setText(initialText);
    if (!next) {
      setText('');
      setResolved([]);
      setOptions(DEFAULT_OPTIONS);
      resolveSeq.current += 1;
    }
    onOpenChange(next);
  }

  function onTextChange(value: string) {
    setText(value);
    // Clear stale preview immediately when the textarea empties so the
    // dialog doesn't keep showing rows from a prior paste.
    if (value.trim().length === 0) setResolved([]);
  }

  const previewRows = useMemo<PreviewRow[]>(() => {
    if (parsed.length === 0) return [];
    const resolvedBySigId = new Map(resolved.map((r) => [r.sigId, r]));
    const existingBySigId = new Map(existingSigs.map((s) => [s.sigId, s]));
    return parsed.map<PreviewRow>((p) => {
      const r = resolvedBySigId.get(p.sigId);
      const merged: ResolvedSigRow =
        r ?? { ...p, groupKey: null, typeId: null };
      const existing = existingBySigId.get(p.sigId);
      let status: RowStatus;
      if (!existing) {
        status = 'new';
      } else {
        const groupDiffers =
          merged.groupKey !== null && merged.groupKey !== existing.groupKey;
        // For wormhole rows, the type id is the meaningful signal. For
        // cosmic rows, type id is always null on both sides — name is what
        // changes. Treat a non-null incoming name differing from the existing
        // as an update.
        const typeDiffers =
          merged.groupKey === 'wormhole'
            ? merged.typeId !== null && merged.typeId !== existing.typeId
            : merged.name !== null && merged.name !== existing.name;
        status = groupDiffers || typeDiffers ? 'update' : 'unchanged';
      }
      // Only flag as unresolvable when the paste carried a Group cell but
      // we failed to classify it. Cosmic rows with a non-null name but
      // null typeId are expected (no SDE backing) and are NOT unresolvable.
      if (status === 'new' && p.groupName && merged.groupKey === null) {
        status = 'unresolvable';
      }
      return { ...merged, status };
    });
  }, [parsed, resolved, existingSigs]);

  const removeRows = useMemo(() => {
    if (parsed.length === 0) return [];
    const incoming = new Set(parsed.map((p) => p.sigId));
    return existingSigs.filter((s) => !incoming.has(s.sigId));
  }, [parsed, existingSigs]);

  const counts = useMemo(() => {
    let added = 0;
    let updated = 0;
    for (const r of previewRows) {
      if (r.status === 'new' && options.addMissing) added += 1;
      if (r.status === 'update' && options.updateExisting) updated += 1;
    }
    const removed = options.removeMissing ? removeRows.length : 0;
    const conns =
      options.removeMissing && options.removeOrphanedConnections
        ? removeRows.filter((s) => s.mapConnectionId !== null).length
        : 0;
    return { added, updated, removed, conns };
  }, [previewRows, removeRows, options]);

  const submitDisabled =
    pending ||
    parsed.length === 0 ||
    counts.added + counts.updated + counts.removed === 0;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const ok = await applySignaturePaste({
        mapId,
        mapSystemId,
        rows: parsed,
        options,
        onResult,
      });
      if (ok) handleOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Paste signatures</DialogTitle>
          <DialogDescription>
            Paste the in-game probe-scanner output. The preview reconciles against the current system.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <textarea
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            placeholder={'ID\tClass\tGroup\tName\tSignal\tDistance'}
            className="h-28 resize-none rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            autoFocus
            spellCheck={false}
          />

          <PreviewTable rows={previewRows} removeRows={removeRows} options={options} />

          <OptionsRow options={options} setOptions={setOptions} />

          <div className="text-[11px] text-muted-foreground">
            {parsed.length === 0
              ? 'No rows parsed yet.'
              : `Will commit ${counts.added + counts.updated + counts.removed} events ` +
                `(${counts.added} add, ${counts.updated} update, ${counts.removed} remove` +
                (counts.conns ? `, ${counts.conns} connections` : '') +
                `).`}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitDisabled} className="gap-1.5">
              <ClipboardPaste className="size-4" />
              {pending ? 'Applying…' : 'Apply paste'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PreviewTable({
  rows,
  removeRows,
  options,
}: {
  rows: PreviewRow[];
  removeRows: MapSignature[];
  options: BulkPasteOptions;
}) {
  if (rows.length === 0 && removeRows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
        Preview appears here once a valid paste is detected.
      </div>
    );
  }
  return (
    <div className="max-h-64 overflow-auto rounded-md ring-1 ring-foreground/10">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted/60 text-[10px] uppercase text-muted-foreground">
          <tr>
            <th className="w-8 px-1.5 py-1" />
            <th className="px-1.5 py-1 text-left">Sig</th>
            <th className="px-1.5 py-1 text-left">Group</th>
            <th className="px-1.5 py-1 text-left">Type</th>
            <th className="px-1.5 py-1 text-left">Signal</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`in-${r.sigId}`}
              className={
                'border-t border-foreground/10 ' +
                (r.status === 'unresolvable' ? 'text-muted-foreground' : '')
              }
            >
              <td className="px-1.5 py-1 text-center">
                <StatusIcon status={r.status} options={options} />
              </td>
              <td className="px-1.5 py-1 font-mono">{r.sigId}</td>
              <td className="px-1.5 py-1">{r.groupName ?? '—'}</td>
              <td className="px-1.5 py-1">{r.name ?? '—'}</td>
              <td className="px-1.5 py-1">{r.signal ?? '—'}</td>
            </tr>
          ))}
          {options.removeMissing &&
            removeRows.map((s) => (
              <tr key={`rm-${s.id}`} className="border-t border-foreground/10 text-destructive">
                <td className="px-1.5 py-1 text-center">
                  <Trash2 className="mx-auto size-3.5" aria-label="Will be removed" />
                </td>
                <td className="px-1.5 py-1 font-mono">{s.sigId}</td>
                <td className="px-1.5 py-1" colSpan={2}>
                  Existing — will be removed
                  {options.removeOrphanedConnections && s.mapConnectionId !== null && (
                    <span className="ml-1.5 inline-flex items-center gap-0.5">
                      <Link2Off className="size-3" />
                      connection too
                    </span>
                  )}
                </td>
                <td className="px-1.5 py-1">—</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusIcon({ status, options }: { status: RowStatus; options: BulkPasteOptions }) {
  if (status === 'new') {
    return options.addMissing ? (
      <Plus className="mx-auto size-3.5 text-emerald-500" aria-label="Will be added" />
    ) : (
      <Plus className="mx-auto size-3.5 text-muted-foreground/40" aria-label="Skipped — add disabled" />
    );
  }
  if (status === 'update') {
    return options.updateExisting ? (
      <Pencil className="mx-auto size-3.5 text-amber-500" aria-label="Will be updated" />
    ) : (
      <Pencil className="mx-auto size-3.5 text-muted-foreground/40" aria-label="Skipped — update disabled" />
    );
  }
  if (status === 'unresolvable') {
    return <HelpCircle className="mx-auto size-3.5" aria-label="Unresolved group / type" />;
  }
  return <span className="text-muted-foreground/40">·</span>;
}

function OptionsRow({
  options,
  setOptions,
}: {
  options: BulkPasteOptions;
  setOptions: (next: BulkPasteOptions) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
      <Toggle
        label="Add new"
        checked={options.addMissing}
        onChange={(v) => setOptions({ ...options, addMissing: v })}
      />
      <Toggle
        label="Update existing"
        checked={options.updateExisting}
        onChange={(v) => setOptions({ ...options, updateExisting: v })}
      />
      <Toggle
        label="Remove missing"
        checked={options.removeMissing}
        onChange={(v) => setOptions({ ...options, removeMissing: v })}
      />
      <Toggle
        label="Also remove orphan connections"
        checked={options.removeOrphanedConnections}
        disabled={!options.removeMissing}
        onChange={(v) => setOptions({ ...options, removeOrphanedConnections: v })}
      />
    </div>
  );
}

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      className={
        'flex items-center gap-1.5 ' + (disabled ? 'text-muted-foreground/50' : '')
      }
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
