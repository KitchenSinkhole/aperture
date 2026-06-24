'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { fetchWormholeCatalog } from '@/lib/map/client';
import { systemClassColor } from '@/components/map/styling';
import { annotateWormholeTypes, type WormholeCatalogEntry } from '@/lib/map/wormholeCatalog';
import type { WormholeTypeOption } from '@/types';

const NONE_VALUE = '__none__';

function OptionDivider() {
  return <div className="my-0.5 h-px bg-border" />;
}

/**
 * Class-filtered wormhole-type dropdown for the signature inspector. Loads the
 * static, system-independent WH catalog once per session (shared by every
 * dropdown via `fetchWormholeCatalog`), then derives this system's class
 * grouping locally with `annotateWormholeTypes` — no per-system fetch.
 */
export function WormholeTypeSelect({
  systemSecurity,
  staticTypeIds,
  value,
  onValueChange,
  disabled,
  triggerClassName,
}: {
  /** Host system's class label (`MapSystemNode.security`) — drives `matchesClass`. */
  systemSecurity: string | null;
  /** Host system's static `universe_wormhole.type_id` set (`MapSystemNode.staticTypeIds`). */
  staticTypeIds: number[];
  /** Selected `universe_wormhole.type_id`, or null when unset. */
  value: number | null;
  onValueChange: (next: number | null) => void;
  disabled?: boolean;
  triggerClassName?: string;
}) {
  // Combine `loading` and `catalog` in one state object so the effect body only
  // calls `setState` from the async resolver — never synchronously during the
  // effect run (which would trip the cascading-render lint rule).
  const [state, setState] = useState<{ loading: boolean; catalog: WormholeCatalogEntry[] }>({
    loading: true,
    catalog: [],
  });
  // Whether the "other classes" group (holes that don't plausibly spawn here) is
  // expanded. Collapsed by default — the whole point is a short list.
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchWormholeCatalog().then((result) => {
      if (cancelled) return;
      setState({ loading: false, catalog: result.ok ? result.data : [] });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const { loading } = state;
  const options = useMemo(
    () => annotateWormholeTypes(state.catalog, { security: systemSecurity, staticTypeIds }),
    [state.catalog, systemSecurity, staticTypeIds],
  );

  const items = useMemo(() => {
    const labels: Record<string, string> = { [NONE_VALUE]: 'Select type…' };
    for (const opt of options) labels[String(opt.typeId)] = opt.name;
    return labels;
  }, [options]);

  // Three groups: the system's statics (pinned), holes that plausibly spawn in
  // this class (shown by default), and everything else (behind "show all").
  // Each keeps the server's alphabetical order.
  const { statics, exitHole, classMatched, others } = useMemo(() => {
    const statics: WormholeTypeOption[] = [];
    let exitHole: WormholeTypeOption | undefined;
    const classMatched: WormholeTypeOption[] = [];
    const others: WormholeTypeOption[] = [];
    for (const opt of options) {
      if (opt.isStatic) statics.push(opt);
      else if (opt.name === 'K162') exitHole = opt;
      else if (opt.matchesClass) classMatched.push(opt);
      else others.push(opt);
    }

    return { statics, exitHole, classMatched, others };
  }, [options]);

  const stringValue = value == null ? NONE_VALUE : String(value);

  // Color-code the destination class with the same palette the map uses for
  // system-node statics, so a hole's target reads consistently in both places.
  const renderOption = (opt: WormholeTypeOption) => (
    <SelectItem className="py-1" key={opt.typeId} value={String(opt.typeId)}>
      <span className="flex w-full justify-between gap-4">
        <span>{opt.name}</span>
        {opt.targetClass && (
          <span
            className="shrink-0 font-bold"
            style={{ color: systemClassColor(opt.targetClass) }}
          >
            {opt.targetClass}
          </span>
        )}
      </span>
    </SelectItem>
  );

  return (
    <Select<string>
      value={stringValue}
      onValueChange={(next) => {
        if (!next || next === NONE_VALUE) onValueChange(null);
        else onValueChange(Number(next));
      }}
      items={items}
      disabled={disabled || loading}
    >
      <SelectTrigger className={triggerClassName}>
        <SelectValue className="min-w-0 flex-1">
          {(val: string) => {
            const opt = val === NONE_VALUE ? undefined : options.find((o) => String(o.typeId) === val);
            if (!opt) return loading ? 'Loading…' : 'Select type…';
            return (
              <span className="flex min-w-0 flex-1 items-center justify-between gap-4">
                <span className="truncate">{opt.name}</span>
                {opt.targetClass && (
                  <span
                    className="shrink-0 font-bold"
                    style={{ color: systemClassColor(opt.targetClass) }}
                  >
                    {opt.targetClass}
                  </span>
                )}
              </span>
            );
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="p-0.5">
        <SelectItem className="py-1" value={NONE_VALUE}>
          {loading ? 'Loading…' : 'Select type…'}
        </SelectItem>
        {statics.length > 0 && (
          <>
            <div className="px-2 pt-1 pb-0.5 text-[11px] font-medium uppercase text-muted-foreground">
              Statics
            </div>
            {statics.map(renderOption)}
          </>
        )}
        
        {exitHole && <>
          <OptionDivider />
          {renderOption(exitHole)}
        </>}
        
        {classMatched.length > 0 && <OptionDivider />}
        {classMatched.map(renderOption)}

        {others.length > 0 && (
          <>
            <OptionDivider />
            <button
              type="button"
              // Toggle the "other classes" group without selecting an item or
              // dismissing the popup (this isn't a SelectItem, so base-ui leaves
              // it alone — just stop the click from bubbling to the trigger).
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowAll((v) => !v);
              }}
              className="w-full rounded-md px-2 py-1 text-left text-[11px] font-medium uppercase text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {showAll ? 'Show fewer' : `Show all types (+${others.length})`}
            </button>
            {showAll && others.map(renderOption)}
          </>
        )}
      </SelectContent>
    </Select>
  );
}
