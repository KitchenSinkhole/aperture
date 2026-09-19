'use client';

import { useMemo } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { systemClassColor } from '@/components/map/styling';
import { classTagLabel } from '@/lib/tagging/display';
import type { MapConnectionEdge, MapSystemNode, TagScheme } from '@/types';

const NONE_VALUE = '__none__';

/**
 * Dropdown of connections incident to the active system. Each option labels
 * the other end's `alias ?? name`, optionally followed by the resolved
 * security/class (when known). Used in `SignatureModule` to bind a wormhole
 * signature to a placed connection. No API call — driven entirely off the
 * canvas's already-loaded `connections` and `systems`.
 *
 * When `targetClass` is set (the selected WH type's destination class, e.g.
 * `LS` for a U210), the list is filtered to connections whose far end matches
 * that class — a U210 can only ever lead to lowsec. The currently-bound
 * connection is always kept in the list so changing the type after binding
 * doesn't blank the trigger. A null `targetClass` (e.g. K162) means "leads
 * anywhere", so no filtering is applied.
 *
 * `excludeIds` drops connections already claimed by another signature in the
 * same system — the sig↔connection binding is 1:1, so a connection that's
 * spoken for shouldn't be offered again. The current `value` is always exempt
 * so the row keeps showing its own binding.
 *
 * The far end's class+tag label is scheme-dependent (`classTagLabel`), so the
 * map's `tagScheme` has to be passed in.
 */
export function ConnectionSelect({
  system,
  connections,
  systems,
  value,
  onValueChange,
  disabled,
  targetClass,
  excludeIds,
  triggerClassName,
  tagScheme,
}: {
  system: MapSystemNode;
  connections: MapConnectionEdge[];
  systems: MapSystemNode[];
  value: string | null;
  onValueChange: (next: string | null) => void;
  disabled?: boolean;
  targetClass?: string | null;
  excludeIds?: string[];
  triggerClassName?: string;
  tagScheme: TagScheme;
}) {
  const options = useMemo(() => {
    const systemsById = new Map(systems.map((s) => [s.id, s]));
    return connections
      .filter((c) => c.source === system.id || c.target === system.id)
      .map((c) => {
        const otherId = c.source === system.id ? c.target : c.source;
        const other = systemsById.get(otherId);
        if (!other) return null;
        const label = other.alias ?? other.name;
        const cls = classTagLabel(other.security, other.tag, tagScheme);
        return { id: c.id, label, cls, security: other.security };
      })
      .filter(
        (x): x is { id: string; label: string; cls: string; security: string | null } =>
          x !== null,
      )
      .filter((o) => !targetClass || o.security === targetClass || o.id === value)
      .filter((o) => o.id === value || !excludeIds?.includes(o.id));
  }, [connections, systems, system.id, targetClass, value, excludeIds, tagScheme]);

  const items = useMemo(() => {
    const labels: Record<string, string> = { [NONE_VALUE]: '—' };
    for (const o of options) {
      labels[o.id] = o.cls ? `${o.label} (${o.cls})` : o.label;
    }
    return labels;
  }, [options]);

  const stringValue = value ?? NONE_VALUE;

  return (
    <Select<string>
      value={stringValue}
      onValueChange={(next) => {
        if (!next || next === NONE_VALUE) onValueChange(null);
        else onValueChange(next);
      }}
      items={items}
      disabled={disabled || options.length === 0}
    >
      <SelectTrigger className={triggerClassName}>
        <SelectValue className="min-w-0 flex-1">
          {(val: string) => {
            const o = val === NONE_VALUE ? undefined : options.find((x) => x.id === val);
            if (!o) return '—';
            return (
              <span className="flex min-w-0 flex-1 items-center justify-between gap-4">
                <span className="truncate">{o.label}</span>
                {o.cls ? (
                  <span
                    className="shrink-0 text-xs font-bold"
                    style={{ color: systemClassColor(o.security) }}
                  >
                    {o.cls}
                  </span>
                ) : null}
              </span>
            );
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="p-0.5">
        <SelectItem className="py-1" value={NONE_VALUE}>
          —
        </SelectItem>
        {options.map((o) => (
          <SelectItem className="py-1" key={o.id} value={o.id}>
            <span className="flex w-full justify-between gap-4">
              <span>{o.label}</span>
              {o.cls ? (
                // Color the whole class+tag label with the same palette the map
                // uses for system-node statics, so a hole's target reads
                // consistently in both places.
                <span
                  className="text-xs font-bold"
                  style={{ color: systemClassColor(o.security) }}
                >
                  {o.cls}
                </span>
              ) : null}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
