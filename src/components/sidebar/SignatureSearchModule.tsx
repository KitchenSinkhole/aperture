'use client';

import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, ShieldCheck, Swords } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { buildSigSearchResults, type SigSortField, type SigSortDir } from '@/lib/map/sigSearch';
import { SIGNATURE_GROUP_CATALOG, labelForSignatureGroupKey } from '@/lib/map/signatureGroups';
import { effectiveSignatureActivity } from '@/lib/map/siteActivity';
import { formatAgoFromMs } from '@/lib/map/relativeTime';
import { systemClassColor } from '@/components/map/styling';
import { cn } from '@/lib/utils';
import type {
  MapSignature,
  MapSystemNode,
  SigSearchFilters,
  SignatureActivity,
  SignatureClassKind,
  SignatureGroupKey,
} from '@/types';

const CLASS_KIND_TOGGLES: { kind: SignatureClassKind; label: string; title: string }[] = [
  { kind: 'anomaly', label: 'Anoms', title: 'Anomalies' },
  { kind: 'signature', label: 'Sigs', title: 'Signatures' },
];

const SECURITY_CLASS_GROUPS: { heading: string; options: { value: string; label: string }[] }[] = [
  {
    heading: 'Wormhole',
    options: [
      { value: 'C1', label: 'C1' },
      { value: 'C2', label: 'C2' },
      { value: 'C3', label: 'C3' },
      { value: 'C4', label: 'C4' },
      { value: 'C5', label: 'C5' },
      { value: 'C6', label: 'C6' },
    ],
  },
  {
    heading: 'K-Space',
    options: [
      { value: 'H',   label: 'HS' },
      { value: 'L',   label: 'LS' },
      { value: '0.0', label: 'NS' },
      { value: 'P',   label: 'P' },
    ],
  },
];

const ACTIVITY_LABELS: Record<'_all' | SignatureActivity, string> = {
  _all: 'Any',
  combat: 'Combat',
  exploration: 'Exploration',
};

function ActivityGlyph({ sig }: { sig: MapSignature }) {
  const activity = effectiveSignatureActivity(sig);
  if (!activity) return null;
  const Icon = activity === 'combat' ? Swords : ShieldCheck;
  const title = activity === 'combat' ? 'Combat site' : 'Exploration site';
  return (
    <span className="flex items-center justify-center" title={title}>
      <Icon
        className={cn('size-3.5', activity === 'combat' ? 'text-red-500' : 'text-emerald-500')}
      />
    </span>
  );
}

interface Props {
  signatures: MapSignature[];
  systems: MapSystemNode[];
  filters: SigSearchFilters;
  onFiltersChange: (f: SigSearchFilters) => void;
  onNavigate: (systemId: string, sigId: string) => void;
}

export function SignatureSearchModule({
  signatures,
  systems,
  filters,
  onFiltersChange,
  onNavigate,
}: Props) {
  const [sortField, setSortField] = useState<SigSortField>('sigId');
  const [sortDir, setSortDir] = useState<SigSortDir>('asc');
  const [inputName, setInputName] = useState(filters.name);
  const [now, setNow] = useState(() => Date.now());
  const filtersRef = useRef(filters);
  useLayoutEffect(() => { filtersRef.current = filters; });

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      onFiltersChange({ ...filtersRef.current, name: inputName });
    }, 150);
    return () => clearTimeout(t);
  }, [inputName]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(
    () => buildSigSearchResults(signatures, systems, filters, sortField, sortDir, now),
    [signatures, systems, filters, sortField, sortDir, now],
  );

  function handleSortHeader(field: SigSortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  function toggleSecClass(value: string) {
    const current = filters.securityClasses;
    onFiltersChange({
      ...filters,
      securityClasses: current.includes(value)
        ? current.filter((c) => c !== value)
        : [...current, value],
    });
  }

  function toggleClassKind(kind: SignatureClassKind) {
    const key = kind === 'anomaly' ? 'includeAnomalies' : 'includeSignatures';
    onFiltersChange({ ...filters, [key]: !filters[key] });
  }

  function sortIcon(field: SigSortField) {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />;
  }

  return (
    <Card className="flex h-full flex-col gap-3 p-3">
      {/* Filter bar */}
      <div className="flex shrink-0 flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Name</label>
          <Input
            placeholder="Search…"
            value={inputName}
            onChange={(e) => setInputName(e.target.value)}
            className="h-7 w-40 text-xs"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Group</label>
          <Select
            value={filters.groupKey ?? '_all'}
            onValueChange={(v) =>
              onFiltersChange({
                ...filters,
                groupKey: v === '_all' ? null : (v as SignatureGroupKey),
              })
            }
          >
            <SelectTrigger className="h-7 w-36 text-xs">
              <SelectValue>
                {filters.groupKey === null
                  ? 'All Types'
                  : (labelForSignatureGroupKey(filters.groupKey) ?? filters.groupKey)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All Types</SelectItem>
              {SIGNATURE_GROUP_CATALOG.map((g) => (
                <SelectItem key={g.key} value={g.key}>
                  {g.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Activity</label>
          <Select
            value={filters.activity ?? '_all'}
            onValueChange={(v) =>
              onFiltersChange({
                ...filters,
                activity: v === '_all' ? null : (v as SignatureActivity),
              })
            }
          >
            <SelectTrigger className="h-7 w-32 text-xs">
              <SelectValue>{ACTIVITY_LABELS[filters.activity ?? '_all']}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">Any</SelectItem>
              <SelectItem value="combat">Combat</SelectItem>
              <SelectItem value="exploration">Exploration</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Max age (h)</label>
          <Input
            type="number"
            min={0}
            placeholder="Any"
            value={filters.maxAgeHours ?? ''}
            onChange={(e) =>
              onFiltersChange({
                ...filters,
                maxAgeHours: e.target.value === '' ? null : Number(e.target.value),
              })
            }
            className="h-7 w-28 text-xs"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Type</label>
          <div className="flex flex-wrap gap-1">
            {CLASS_KIND_TOGGLES.map(({ kind, label, title }) => {
              const active =
                kind === 'anomaly' ? filters.includeAnomalies : filters.includeSignatures;
              return (
                <button
                  key={kind}
                  type="button"
                  title={title}
                  aria-pressed={active}
                  onClick={() => toggleClassKind(kind)}
                  className={`h-7 rounded-full border px-2 text-xs transition-colors ${
                    active
                      ? 'border-primary/40 bg-primary/15 text-foreground'
                      : 'border-border bg-transparent text-muted-foreground hover:bg-muted/40'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">System class</label>
          <div className="flex flex-wrap gap-1">
            {SECURITY_CLASS_GROUPS.map((group) => (
              <div key={group.heading} className="flex items-center gap-1">
                {group.options.map((opt) => {
                  const active = filters.securityClasses.includes(opt.value);
                  const color = systemClassColor(opt.value);
                  return (
                    <Button
                      key={opt.value}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      style={active ? { color, borderColor: color } : { color }}
                      onClick={() => toggleSecClass(opt.value)}
                    >
                      {opt.label}
                    </Button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Results table */}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-md ring-1 ring-foreground/10">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))] text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="w-6 px-1 py-0.5" />
              <th
                className="w-16 px-2 py-0.5 text-left cursor-pointer select-none"
                onClick={() => handleSortHeader('sigId')}
              >
                <span className="inline-flex items-center gap-0.5">Sig{sortIcon('sigId')}</span>
              </th>
              <th className="w-20 px-2 py-0.5 text-left">Group</th>
              <th
                className="w-px whitespace-nowrap px-2 py-0.5 text-left cursor-pointer select-none"
                onClick={() => handleSortHeader('systemName')}
              >
                <span className="inline-flex items-center gap-0.5">System{sortIcon('systemName')}</span>
              </th>
              <th className="px-2 py-0.5 text-left">Name</th>
              <th
                className="w-24 px-2 py-0.5 text-left cursor-pointer select-none"
                onClick={() => handleSortHeader('age')}
              >
                <span className="inline-flex items-center gap-0.5">Age{sortIcon('age')}</span>
              </th>
              <th className="w-8 px-1 py-0.5" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-2 py-3 text-center text-xs text-muted-foreground"
                >
                  No signatures match your filters.
                </td>
              </tr>
            )}
            {rows.map(({ sig, system, ageMs }) => (
              <tr
                key={sig.id}
                className="group border-t border-foreground/10 align-middle even:bg-foreground/[0.03] hover:bg-muted/30"
              >
                <td className="px-1 py-px">
                  <ActivityGlyph sig={sig} />
                </td>
                <td className="px-2 py-px font-mono text-xs">{sig.sigId}</td>
                <td className="px-2 py-px">
                  {labelForSignatureGroupKey(sig.groupKey) ?? '—'}
                </td>
                <td className="w-px whitespace-nowrap px-2 py-px">
                  {system.alias ?? system.name}
                  {system.security && (
                    <span
                      className="ml-1.5 shrink-0 text-xs font-bold"
                      style={{ color: systemClassColor(system.security) }}
                    >
                      {system.security}{system.tag ?? ''}
                    </span>
                  )}
                </td>
                <td className="px-2 py-px">{sig.name ?? '—'}</td>
                <td className="px-2 py-px text-xs text-muted-foreground tabular-nums">
                  {formatAgoFromMs(ageMs)}
                </td>
                <td className="px-1 py-px">
                  <Button
                    variant="default"
                    size="sm"
                    className="h-6 gap-1 px-2 text-xs opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => onNavigate(system.id, sig.id)}
                    title={`Go to ${system.alias ?? system.name}`}
                  >
                    Go
                    <ArrowRight className="size-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="shrink-0 text-xs text-muted-foreground">
        {rows.length} result{rows.length !== 1 ? 's' : ''}
      </p>
    </Card>
  );
}
