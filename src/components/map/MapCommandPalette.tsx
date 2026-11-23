'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type MapCommandAction = {
  id: string;
  label: string;
  hint?: string;
  keywords?: string;
  run: () => void;
};

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el.isContentEditable;
}

export function MapCommandPalette({
  open,
  onOpenChange,
  actions,
  resolveQueryActions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: MapCommandAction[];
  /** Dynamic actions for the current query (e.g. focus on-map systems); listed first when non-empty. */
  resolveQueryActions?: (query: string) => MapCommandAction[];
}) {
  const [query, setQuery] = useState('');

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) setQuery('');
      onOpenChange(next);
    },
    [onOpenChange],
  );

  const filtered = useMemo(() => {
    const raw = query.trim();
    const q = raw.toLowerCase();
    const focus = raw ? resolveQueryActions?.(raw) ?? [] : [];
    if (!q) return actions;
    const base = actions.filter((a) => {
      const blob = `${a.label} ${a.hint ?? ''} ${a.keywords ?? ''}`.toLowerCase();
      return blob.includes(q);
    });
    return focus.length > 0 ? [...focus, ...base] : base;
  }, [actions, query, resolveQueryActions]);

  const run = useCallback(
    (action: MapCommandAction) => {
      handleOpenChange(false);
      action.run();
    },
    [handleOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg gap-3 p-4">
        <DialogHeader className="gap-1">
          <DialogTitle>Command palette</DialogTitle>
          <DialogDescription>Type to filter map actions. Esc closes.</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search commands…"
          aria-label="Search commands"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && filtered[0]) {
              e.preventDefault();
              run(filtered[0]);
            }
          }}
        />
        <ul className="max-h-72 overflow-y-auto rounded-md border border-border">
          {filtered.map((action) => (
            <li key={action.id}>
              <button
                type="button"
                className={cn(
                  'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted',
                )}
                onClick={() => run(action)}
              >
                <span>{action.label}</span>
                {action.hint ? (
                  <span className="shrink-0 text-xs text-muted-foreground">{action.hint}</span>
                ) : null}
              </button>
            </li>
          ))}
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">No matches.</li>
          ) : null}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

/** Whether bare `f` should fit the map (not when a link is selected and `f` means Fresh mass). */
export function shouldMapFitOnFKey(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>,
  blockFitKey: boolean,
): boolean {
  if (blockFitKey) return false;
  return e.key === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey;
}

export function useMapCommandPaletteKeyboard({
  enabled,
  open,
  actions,
  onOpenChange,
  onFitView,
  onFocusPanel,
  blockFitKey = false,
}: {
  enabled: boolean;
  open: boolean;
  actions: MapCommandAction[];
  onOpenChange: (open: boolean) => void;
  onFitView: () => void;
  onFocusPanel: (panelIndex: 0 | 1 | 2 | 3) => void;
  /** When true, `f` does not trigger fit (e.g. selected wormhole uses `f` for Fresh mass). */
  blockFitKey?: boolean;
}) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenChange(!open);
        return;
      }
      if (isEditable(e.target)) return;
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        onOpenChange(true);
        return;
      }
      if (shouldMapFitOnFKey(e, blockFitKey)) {
        e.preventDefault();
        onFitView();
        return;
      }
      if (/^[1-4]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        onFocusPanel((Number(e.key) - 1) as 0 | 1 | 2 | 3);
        return;
      }
      if (e.key === 'Escape') {
        onOpenChange(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [blockFitKey, enabled, open, onFitView, onFocusPanel, onOpenChange, actions]);
}
