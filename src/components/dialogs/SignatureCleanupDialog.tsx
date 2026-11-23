'use client';

import { useMemo, useState, useTransition } from 'react';
import { Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { SIGNATURE_GROUP_CATALOG } from '@/lib/map/signatureGroups';
import { matchSignaturesForExperimentalCleanup } from '@/lib/map/experimentalSignatureCleanupMatch';
import { isWormholeSystem } from '@/lib/map/space';
import type {
  MapConnectionEdge,
  MapSignature,
  MapSystemNode,
  SignatureGroupKey,
  SignatureIndicatorPrefs,
} from '@/types';

export type SignatureCleanupScope = 'system' | 'chain';

export type SignatureCleanupPanelSettings = {
  scope: SignatureCleanupScope;
  olderThanHours: number | null;
  unscannedOnly: boolean;
  staleByIndicator: boolean;
  whLinkExpired: boolean;
  groups: SignatureGroupKey[];
};

export const DEFAULT_SIGNATURE_CLEANUP_SETTINGS: SignatureCleanupPanelSettings = {
  scope: 'system',
  olderThanHours: 48,
  unscannedOnly: false,
  staleByIndicator: true,
  whLinkExpired: false,
  groups: [],
};

export function SignatureCleanupDialog({
  open,
  onOpenChange,
  mapId,
  selectedSystem,
  systems,
  signatures,
  connections,
  indicatorPrefs,
  settings,
  onSettingsChange,
  onDeleteSignatures,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mapId: string;
  selectedSystem: MapSystemNode | null;
  systems: MapSystemNode[];
  signatures: MapSignature[];
  connections: MapConnectionEdge[];
  indicatorPrefs: SignatureIndicatorPrefs;
  settings: SignatureCleanupPanelSettings;
  onSettingsChange: (next: SignatureCleanupPanelSettings) => void;
  onDeleteSignatures: (signatureIds: string[]) => void;
}) {
  const [pending, startTransition] = useTransition();
  const isWormhole = useMemo(() => {
    const m = new Map(systems.map((s) => [s.id, s]));
    return (mapSystemId: string) => {
      const sys = m.get(mapSystemId);
      return sys ? isWormholeSystem(sys) : false;
    };
  }, [systems]);

  const matched = useMemo(
    () =>
      matchSignaturesForExperimentalCleanup({
        settings,
        selectedSystem,
        systems,
        signatures,
        connections,
        indicatorPrefs,
        isWormholeSystem: isWormhole,
      }),
    [settings, selectedSystem, systems, signatures, connections, indicatorPrefs, isWormhole],
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const handleOpenChange = (next: boolean) => {
    if (next) setSelectedIds(new Set(matched.map((s) => s.id)));
    onOpenChange(next);
  };

  const allSelected =
    matched.length > 0 && matched.every((s) => selectedIds.has(s.id));

  function toggleGroup(g: SignatureGroupKey) {
    const has = settings.groups.includes(g);
    const groups = has ? settings.groups.filter((x) => x !== g) : [...settings.groups, g];
    onSettingsChange({ ...settings, groups });
  }

  function onConfirm() {
    const ids = matched.filter((s) => selectedIds.has(s.id)).map((s) => s.id);
    if (ids.length === 0) return;
    startTransition(() => {
      onDeleteSignatures(ids);
      onOpenChange(false);
      setSelectedIds(new Set());
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" />
            Clean up signatures
          </DialogTitle>
          <DialogDescription>
            Preview signatures to remove on map {mapId}. Wormhole deletes may prompt for subchain
            removal separately.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 text-sm">
          <fieldset className="flex gap-3">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="cleanup-scope"
                checked={settings.scope === 'system'}
                onChange={() => onSettingsChange({ ...settings, scope: 'system' })}
              />
              Selected system
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="cleanup-scope"
                checked={settings.scope === 'chain'}
                onChange={() => onSettingsChange({ ...settings, scope: 'chain' })}
              />
              Whole chain
            </label>
          </fieldset>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium">Older than (hours)</span>
            <input
              type="number"
              min={0}
              className="border-input h-8 w-24 rounded-md border px-2 text-sm"
              value={settings.olderThanHours ?? ''}
              onChange={(e) => {
                const v = e.target.value.trim();
                onSettingsChange({
                  ...settings,
                  olderThanHours: v === '' ? null : Number(v),
                });
              }}
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium">Filters</span>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={settings.staleByIndicator}
                onChange={(e) =>
                  onSettingsChange({ ...settings, staleByIndicator: e.target.checked })
                }
              />
              Stale by signature indicators
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={settings.unscannedOnly}
                onChange={(e) =>
                  onSettingsChange({ ...settings, unscannedOnly: e.target.checked })
                }
              />
              Unscanned only
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={settings.whLinkExpired}
                onChange={(e) =>
                  onSettingsChange({ ...settings, whLinkExpired: e.target.checked })
                }
              />
              WH link expired (EOL)
            </label>
          </div>

          <div className="flex flex-wrap gap-1">
            {SIGNATURE_GROUP_CATALOG.map((g) => (
              <button
                key={g.key}
                type="button"
                className={`rounded border px-1.5 py-0.5 text-[10px] ${
                  settings.groups.includes(g.key)
                    ? 'border-primary bg-primary/10'
                    : 'border-border'
                }`}
                onClick={() => toggleGroup(g.key)}
              >
                {g.label}
              </button>
            ))}
          </div>

          <CleanupPreviewList
            matched={matched}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            allSelected={allSelected}
            settingsScope={settings.scope}
            selectedSystem={selectedSystem}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending || selectedIds.size === 0}
            onClick={onConfirm}
          >
            Delete {selectedIds.size} signature{selectedIds.size === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CleanupPreviewList({
  matched,
  selectedIds,
  setSelectedIds,
  allSelected,
  settingsScope,
  selectedSystem,
}: {
  matched: MapSignature[];
  selectedIds: Set<string>;
  setSelectedIds: (next: Set<string>) => void;
  allSelected: boolean;
  settingsScope: SignatureCleanupScope;
  selectedSystem: MapSystemNode | null;
}) {
  if (settingsScope === 'system' && !selectedSystem) {
    return (
      <p className="text-xs text-muted-foreground">Select a system on the map to preview.</p>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between text-xs">
        <span>
          {matched.length} match{matched.length === 1 ? '' : 'es'}
        </span>
        <button
          type="button"
          className="text-primary underline"
          onClick={() => {
            if (allSelected) setSelectedIds(new Set());
            else setSelectedIds(new Set(matched.map((s) => s.id)));
          }}
        >
          {allSelected ? 'Clear selection' : 'Select all'}
        </button>
      </div>
      <ul className="max-h-40 overflow-auto rounded border text-xs divide-y">
        {matched.length === 0 ? (
          <li className="p-2 text-muted-foreground">No signatures match.</li>
        ) : (
          matched.map((s) => (
            <li key={s.id} className="flex items-center gap-2 p-1">
              <input
                type="checkbox"
                checked={selectedIds.has(s.id)}
                onChange={(e) => {
                  const next = new Set(selectedIds);
                  if (e.target.checked) next.add(s.id);
                  else next.delete(s.id);
                  setSelectedIds(next);
                }}
              />
              <span className="font-mono">{s.sigId}</span>
              <span className="text-muted-foreground">{s.groupKey ?? '—'}</span>
            </li>
          ))
        )}
      </ul>
    </>
  );
}
