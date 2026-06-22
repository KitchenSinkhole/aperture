'use client';

import { Unplug, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/**
 * Non-blocking "restore the remembered connection?" overlay. Mirrors the
 * dismissible `Card` pattern of `SubchainDeletePrompt` so the rest of the UI
 * stays interactive, but is constructive (re-confirm a dormant wormhole
 * connection) rather than destructive. Raised after a paste re-confirms a
 * wormhole sig whose remembered connection is currently dormant/hidden.
 * Visibility is controlled by the parent (rendered only when a prompt is
 * pending). Pinned bottom-right to clear the subchain prompt (bottom-left) and
 * the transit prompt (top-left).
 */
export function RestoreConnectionPrompt({
  targetName,
  onConfirm,
  onDismiss,
}: {
  /** Display name of the connection's far system (alias/name, or a fallback). */
  targetName: string;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <Card className="nodrag nopan absolute right-2 bottom-2 z-10 max-w-xs gap-2 p-3 text-sm shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">
          Restore connection to<span className="text-foreground"> {targetName}</span>?
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-mr-1 -mt-1 size-6 shrink-0"
          aria-label="Dismiss"
          onClick={onDismiss}
        >
          <X className="size-4" />
        </Button>
      </div>
      <Button type="button" variant="secondary" size="sm" className="gap-2" onClick={onConfirm}>
        <Unplug className="size-3.5" />
        Restore connection
      </Button>
    </Card>
  );
}
