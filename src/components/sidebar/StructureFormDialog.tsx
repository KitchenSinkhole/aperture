'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { fetchStructureTypes, searchCorporationsOnServer } from '@/lib/structures/client';
import { IntelScopeChip, intelScopeAudience } from './IntelScopeChip';
import { ccpImageUrl } from '@/lib/integrations/links';
import type { CorpSearchResult, MapType, StructureIntel, UpwellStructureType } from '@/types';

export type StructureFormValues = {
  name: string;
  structureTypeId: number;
  /** EVE corporation id resolved from ESI search; null when the owner is unknown. */
  ownerCorporationId: number | null;
  ownerName: string | null;
  notes: string | null;
};

/** The owner the dialog holds while editing — a resolved corp, or null. */
type OwnerSelection = { id: number | null; name: string };

const CORP_SEARCH_DEBOUNCE_MS = 250;
const CORP_SEARCH_MIN_CHARS = 3;

/** What a new row's audience will be, said in terms of the map it lands on. */
const NEW_SCOPE_AUDIENCE: Record<MapType, string> = {
  private: 'Saved on a private map, so only that map’s owner will see it.',
  corp: 'Saved on a corp map, so that corporation’s members will see it.',
  alliance: 'Saved on an alliance map, so that alliance’s members will see it.',
};

/**
 * Create/edit dialog for a manual structure. `initial` present ⇒ edit mode.
 * Loads the Upwell type catalog (cached) the first time it opens.
 */
export function StructureFormDialog({
  open,
  onOpenChange,
  systemName,
  mapType,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  systemName: string;
  /** The open map's type; a new row's scope is derived from it server-side. */
  mapType: MapType;
  initial?: StructureIntel;
  onSubmit: (values: StructureFormValues) => void;
}) {
  const [types, setTypes] = useState<UpwellStructureType[]>([]);

  // An edit keeps the row's own scope, which need not be the open map's.
  const scope = initial ? initial.scope : mapType;
  const audience = initial ? intelScopeAudience(initial.scope) : NEW_SCOPE_AUDIENCE[mapType];

  useEffect(() => {
    if (!open || types.length > 0) return;
    let cancelled = false;
    void fetchStructureTypes().then((result) => {
      if (!cancelled && result.ok) setTypes(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [open, types.length]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit structure' : 'Add structure'}</DialogTitle>
          <DialogDescription>Manual intel for {systemName}.</DialogDescription>
        </DialogHeader>

        {/* Audience before submit: the failure mode is writing staging intel
            believing it is private. Scope is derived, never picked. */}
        <p className="flex items-start gap-2 rounded border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
          <IntelScopeChip scope={scope} className="mt-0.5" />
          <span>{audience}</span>
        </p>

        {/* The dialog popup unmounts on close, so StructureForm remounts on each
            open and its useState initializers reset the fields from `initial`.
            The key guards the in-place edit→edit case if the popup ever keeps
            mounted. */}
        <StructureForm
          key={initial?.id ?? 'new'}
          initial={initial}
          types={types}
          onSubmit={onSubmit}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function StructureForm({
  initial,
  types,
  onSubmit,
  onClose,
}: {
  initial?: StructureIntel;
  types: UpwellStructureType[];
  onSubmit: (values: StructureFormValues) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [typeId, setTypeId] = useState(initial ? String(initial.structureTypeId) : '');
  const [owner, setOwner] = useState<OwnerSelection | null>(
    initial?.ownerName ? { id: initial.ownerCorporationId, name: initial.ownerName } : null,
  );
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const typeLabels = useMemo(
    () => Object.fromEntries(types.map((t) => [String(t.typeId), t.name])),
    [types],
  );
  // Sort by group then name so related structures cluster in the flat list.
  const sortedTypes = useMemo(
    () =>
      [...types].sort(
        (a, b) => a.groupName.localeCompare(b.groupName) || a.name.localeCompare(b.name),
      ),
    [types],
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Name is required.');
      return;
    }
    const numericTypeId = Number(typeId);
    if (!Number.isInteger(numericTypeId) || numericTypeId <= 0) {
      toast.error('Pick a structure type.');
      return;
    }
    onSubmit({
      name: trimmed,
      structureTypeId: numericTypeId,
      ownerCorporationId: owner?.id ?? null,
      ownerName: owner?.name ?? null,
      notes: notes.trim() || null,
    });
    onClose();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="structure-name" className="text-sm font-medium">
          Name
        </label>
        <Input
          id="structure-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Astrahus on the sun"
          autoFocus
          maxLength={100}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Type</span>
        <Select<string> value={typeId} onValueChange={(v) => v && setTypeId(v)} items={typeLabels}>
          <SelectTrigger>
            <SelectValue placeholder={types.length === 0 ? 'Loading…' : 'Select a type'} />
          </SelectTrigger>
          <SelectContent>
            {sortedTypes.map((t) => (
              <SelectItem key={t.typeId} value={String(t.typeId)}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">
          Owner <span className="text-muted-foreground">(optional)</span>
        </span>
        <OwnerCorpField value={owner} onChange={setOwner} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="structure-notes" className="text-sm font-medium">
          Notes <span className="text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="structure-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Reinforced until…, anchoring, etc."
          rows={3}
          maxLength={2000}
          className="rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">{initial ? 'Save' : 'Add structure'}</Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Corporation owner picker. Either shows the selected corp as a chip (with its
 * CCP logo when an id is resolved) and a clear button, or a debounced search box
 * whose dropdown maps the owner to a real EVE corporation via ESI. Plain
 * free-text owners load as a chip with a null id (no logo) until re-picked.
 */
function OwnerCorpField({
  value,
  onChange,
}: {
  value: OwnerSelection | null;
  onChange: (next: OwnerSelection | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CorpSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  // Drops out-of-order responses: only the latest issued request may commit.
  const requestSeq = useRef(0);

  useEffect(() => {
    if (value !== null) return; // not searching while a corp is selected
    const trimmed = query.trim();
    const seq = ++requestSeq.current;
    const timer = setTimeout(async () => {
      const data =
        trimmed.length < CORP_SEARCH_MIN_CHARS ? [] : await fetchResults(trimmed);
      if (seq !== requestSeq.current) return;
      setResults(data);
      setLoading(false);
    }, CORP_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);

    async function fetchResults(q: string): Promise<CorpSearchResult[]> {
      const result = await searchCorporationsOnServer(q);
      return result.ok ? result.data : [];
    }
  }, [query, value]);

  function choose(corp: CorpSearchResult) {
    onChange({ id: corp.id, name: corp.name });
    setQuery('');
    setResults([]);
  }

  function clear() {
    onChange(null);
    setQuery('');
    setResults([]);
  }

  if (value !== null) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-input px-3 py-2">
        <span className="flex min-w-0 items-center gap-2 text-sm">
          {value.id !== null ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={ccpImageUrl('corporations', value.id, 'logo', 32)}
              alt=""
              className="size-5 shrink-0 rounded-sm"
            />
          ) : null}
          <span className="truncate">{value.name}</span>
        </span>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="Clear owner"
          onClick={clear}
        >
          <X className="size-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        {loading ? (
          <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
        <Input
          value={query}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            setLoading(next.trim().length >= CORP_SEARCH_MIN_CHARS);
          }}
          placeholder="Search corporation by name"
          className="pl-8"
        />
      </div>

      {query.trim().length >= CORP_SEARCH_MIN_CHARS ? (
        <div className="mt-1 max-h-56 overflow-auto rounded-md ring-1 ring-foreground/10">
          {results.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              {loading ? 'Searching…' : 'No matching corporations.'}
            </div>
          ) : (
            <ul>
              {results.map((corp) => (
                <li key={corp.id}>
                  <button
                    type="button"
                    onClick={() => choose(corp)}
                    className="flex w-full items-center gap-2 border-t border-foreground/10 px-3 py-2 text-left text-xs first:border-t-0 hover:bg-muted/50"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={ccpImageUrl('corporations', corp.id, 'logo', 32)}
                      alt=""
                      className="size-5 shrink-0 rounded-sm"
                    />
                    <span className="truncate">{corp.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
