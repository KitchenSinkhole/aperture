'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NoteContent } from '@/components/map/NoteContent';
import { searchSystemNotesOnServer } from '@/lib/system-notes/client';
import { formatAgoFromMs } from '@/lib/map/relativeTime';
import { CategoryChip } from './SystemNotesModule';
import { IntelScopeChip } from './IntelScopeChip';
import type { SystemNoteCategoryDef, SystemNoteSearchResult } from '@/types';

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_MIN_CHARS = 2;

/**
 * Notes browser: search every system note the viewer's scope admits, by body
 * text, system name, or category chip, newest first (the server filters to
 * admitted rows before its cap). Clicking a result jumps to that system on the
 * current map (the parent decides what "jump" means and how to handle a system
 * that isn't on the map).
 */
export function SystemNotesBrowserDialog({
  open,
  onOpenChange,
  categories,
  onJumpToSystem,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The deployment's category vocabulary, for chip colours on results. */
  categories: SystemNoteCategoryDef[];
  onJumpToSystem: (systemId: number) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[70vh] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>System notes</DialogTitle>
          <DialogDescription>
            Search your visible system notes — by note text, system name, or category.
          </DialogDescription>
        </DialogHeader>
        {/* The search UI unmounts on close, so query/results reset on each open. */}
        {open ? <BrowserSearch categories={categories} onJumpToSystem={onJumpToSystem} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function BrowserSearch({
  categories,
  onJumpToSystem,
}: {
  categories: SystemNoteCategoryDef[];
  onJumpToSystem: (systemId: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SystemNoteSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const requestSeq = useRef(0);

  // Debounced search. All state updates happen inside the timer callback /
  // response handler; a stale response (an earlier request resolving after a
  // later one) is dropped via the sequence counter.
  useEffect(() => {
    const trimmed = query.trim();
    const seq = ++requestSeq.current;
    const timer = setTimeout(() => {
      if (trimmed.length < SEARCH_MIN_CHARS) {
        setResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      void searchSystemNotesOnServer(trimmed).then((result) => {
        if (seq !== requestSeq.current) return;
        setSearching(false);
        // On failure, clear rather than leave the previous query's hits on
        // screen mismatching the input (requestJson already toasts the error).
        setResults(result.ok ? result.data : []);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const trimmed = query.trim();

  return (
    <>
      <div className="relative">
        <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="J123456, warning, Fortizar, farm hole…"
          autoFocus
          className="pl-8"
        />
        {searching ? (
          <Loader2 className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
      </div>
      {/* The scroller itself is height-capped (the DialogContent clips overflow,
          so an unbounded list would push lower results out of reach). */}
      <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto text-xs">
        {trimmed.length < SEARCH_MIN_CHARS ? (
          <p className="text-muted-foreground">Type at least {SEARCH_MIN_CHARS} characters.</p>
        ) : results.length === 0 && !searching ? (
          <p className="text-muted-foreground">No notes match.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {results.map((r) => (
              <li key={r.id}>
                {/* Not a <button>: the markdown body can contain links, and
                    interactive content inside a button is invalid HTML. Clicks
                    that originate on a link follow the link only. */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('a')) return;
                    onJumpToSystem(r.systemId);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onJumpToSystem(r.systemId);
                    }
                  }}
                  className="flex w-full cursor-pointer flex-col gap-1 rounded border border-border p-2 text-left hover:bg-accent/50"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono font-medium text-foreground">{r.systemName}</span>
                    <IntelScopeChip scope={r.scope} />
                    {r.category ? <CategoryChip category={r.category} categories={categories} /> : null}
                  </span>
                  <NoteContent content={r.body} className="line-clamp-3" />
                  <span className="text-[10px] text-muted-foreground">
                    {r.createdByName ? `${r.createdByName} · ` : ''}
                    {relativeTime(r.createdAt)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  return formatAgoFromMs(Date.now() - then, 'long');
}
