'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
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
import {
  applySignaturePaste,
  FAST_PASTE_OPTIONS,
  LAZY_DELETE_PASTE_OPTIONS,
} from '@/lib/map/applySignaturePaste';
import { usePresenceStore } from './MapPresenceContext';
import { SignaturePasteDialog } from '@/components/dialogs/SignaturePasteDialog';
import { readPastePreviewOnCtrlV } from '@/lib/experimentalQolPrefs';
import type { MapEventPayload, MapSignature, MapSystemNode, ParsedSigRow } from '@/types';

/** Target system for a paste: explicit selection, else optional experimental fallback. */
export function resolveSignaturePasteTargetSystem(
  selectedSystem: MapSystemNode | null,
  fallbackSystem?: MapSystemNode | null,
): MapSystemNode | null {
  return selectedSystem ?? fallbackSystem ?? null;
}

/**
 * Fast-scanning CTRL+V: a document-level `paste` listener that applies in-game
 * probe-scanner clipboard data straight to the selected system via the bulk
 * endpoint — skipping the `SignaturePasteDialog`. The paste applies directly
 * only when one of the viewer's pilots is confirmed to be *in* the selected
 * system; otherwise a confirm dialog gates the apply (this covers both "your
 * pilot is in a different system" and "none of your pilots is located here").
 *
 * Must be rendered inside `MapPresenceProvider` so it can read live presence.
 */
export function SignaturePasteHotkey({
  mapId,
  selectedSystem,
  /** Experimental: last primary system when pane click preserved selection. */
  fallbackSystem,
  systems,
  viewerCharacterIds,
  onBulkPaste,
  lazyDelete,
  onLazyDeleteConsume,
  onLazyDeletePasteResult,
  signatures,
}: {
  mapId: string;
  selectedSystem: MapSystemNode | null;
  fallbackSystem?: MapSystemNode | null;
  systems: MapSystemNode[];
  signatures: readonly MapSignature[];
  viewerCharacterIds: number[];
  onBulkPaste: (payloads: MapEventPayload[]) => void;
  /** When armed, the next committed direct paste also removes missing sigs. */
  lazyDelete: boolean;
  /** Disarms the one-shot lazy-delete toggle after a paste commits. */
  onLazyDeleteConsume: () => void;
  /**
   * Result handler for a lazy-delete paste: folds the payloads and offers the
   * subchain-delete prompt for each removed wormhole sig. Used in place of
   * `onBulkPaste` when the lazy-delete arm is set.
   */
  onLazyDeletePasteResult: (payloads: MapEventPayload[]) => void;
}) {
  const store = usePresenceStore();

  const [confirm, setConfirm] = useState<{
    rows: ParsedSigRow[];
    targetSystem: MapSystemNode;
    /** Name of a system one of the viewer's pilots is in, or null if none are located. */
    locationName: string | null;
  } | null>(null);
  const [preview, setPreview] = useState<{
    text: string;
    targetSystem: MapSystemNode;
  } | null>(null);

  // The paste listener is registered once; it reads the latest props/state
  // through this ref so a selection or location change doesn't re-subscribe.
  // The ref is updated in an effect (not during render) — same pattern as
  // `useTraversals` in MapPresenceContext.
  const latest = useRef({
    mapId,
    selectedSystem,
    fallbackSystem: fallbackSystem ?? null,
    systems,
    viewerCharacterIds,
    store,
    onBulkPaste,
    lazyDelete,
    onLazyDeleteConsume,
    onLazyDeletePasteResult,
  });
  useEffect(() => {
    latest.current = {
      mapId,
      selectedSystem,
      fallbackSystem: fallbackSystem ?? null,
      systems,
      viewerCharacterIds,
      store,
      onBulkPaste,
      lazyDelete,
      onLazyDeleteConsume,
      onLazyDeletePasteResult,
    };
  });

  const apply = useCallback((rows: ParsedSigRow[], targetSystem: MapSystemNode) => {
    const { mapId, onBulkPaste, lazyDelete, onLazyDeleteConsume, onLazyDeletePasteResult } =
      latest.current;
    // Capture the armed flag at apply time; the one-shot is consumed only once
    // the paste actually commits, so a failed paste leaves it armed to retry.
    // When armed, the result handler also raises the subchain-delete prompt for
    // each removed wormhole sig.
    const armed = lazyDelete;
    void applySignaturePaste({
      mapId,
      mapSystemId: targetSystem.id,
      rows,
      options: armed ? LAZY_DELETE_PASTE_OPTIONS : FAST_PASTE_OPTIONS,
      onResult: armed ? onLazyDeletePasteResult : onBulkPaste,
    }).then((ok) => {
      if (ok && armed) onLazyDeleteConsume();
    });
  }, []);

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (isEditable(e.target)) return; // user is typing into a field — leave native paste alone
      const text = e.clipboardData?.getData('text') ?? '';
      if (!text) return;
      const rows = parseSignaturePaste(text);
      if (rows.length === 0) return; // not scanner data — don't hijack the paste
      e.preventDefault();

      const { selectedSystem, fallbackSystem, systems, viewerCharacterIds, store } = latest.current;
      const targetSystem = resolveSignaturePasteTargetSystem(
        selectedSystem,
        fallbackSystem,
      );
      if (!targetSystem) {
        toast.info('Select a system on the map to paste scanned signatures into it.');
        return;
      }

      if (readPastePreviewOnCtrlV()) {
        setPreview({ text, targetSystem });
        return;
      }

      // The EVE solar-system ids the viewer's pilots are currently located in
      // (read live off the stable store instance).
      const myLocations = viewerCharacterIds
        .map((id) => store?.getSystemForCharacter(id) ?? null)
        .filter((s): s is number => s !== null);

      if (myLocations.includes(targetSystem.systemId)) {
        apply(rows, targetSystem); // a pilot is in the selected system — fast path
        return;
      }

      // No pilot here: confirm. Name a system a pilot *is* in, when we know one.
      const elsewhere = myLocations[0] ?? null;
      const onMap = elsewhere === null ? undefined : systems.find((s) => s.systemId === elsewhere);
      const locationName =
        elsewhere === null
          ? null
          : onMap
            ? (onMap.alias ?? onMap.name)
            : 'another system (not on this map)';
      setConfirm({ rows, targetSystem, locationName });
    }

    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [apply]);

  const targetName = confirm ? (confirm.targetSystem.alias ?? confirm.targetSystem.name) : '';

  const previewSigs = preview
    ? signatures.filter((s) => s.mapSystemId === preview.targetSystem.id)
    : [];

  return (
    <>
      {preview ? (
        <SignaturePasteDialog
          open
          onOpenChange={(open) => !open && setPreview(null)}
          mapId={mapId}
          mapSystemId={preview.targetSystem.id}
          existingSigs={previewSigs}
          initialText={preview.text}
          onResult={(payloads) => {
            const armed = latest.current.lazyDelete;
            if (armed) latest.current.onLazyDeletePasteResult(payloads);
            else latest.current.onBulkPaste(payloads);
            if (armed) latest.current.onLazyDeleteConsume();
            setPreview(null);
          }}
        />
      ) : null}
    <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Location doesn&apos;t match</DialogTitle>
          <DialogDescription>
            {confirm?.locationName
              ? `Your pilot is in ${confirm.locationName}, but the selected system is ${targetName}. Apply the scanned signatures to ${targetName} anyway?`
              : `None of your characters is in ${targetName}. Apply the scanned signatures there anyway?`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (confirm) apply(confirm.rows, confirm.targetSystem);
              setConfirm(null);
            }}
          >
            Apply anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}
