'use client';

import { useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { eveClockPhase, minutesUntilDowntime } from '@/lib/esi/downtime';

const EVE_CLOCK_TICK_MS = 1000;

// Shared tick store: `getSnapshot` must return a stable value between ticks, so
// the minute-of-epoch (not a fresh Date) is the snapshot. `null` on the server
// so no live time is rendered during SSR — avoids a hydration mismatch.
let currentMinute: number | null = null;
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (currentMinute === null) currentMinute = Math.floor(Date.now() / 60_000);
  const id = setInterval(() => {
    const minute = Math.floor(Date.now() / 60_000);
    if (minute !== currentMinute) {
      currentMinute = minute;
      for (const cb of listeners) cb();
    }
  }, EVE_CLOCK_TICK_MS);
  return () => {
    listeners.delete(onChange);
    clearInterval(id);
  };
}

function getSnapshot(): number | null {
  return currentMinute;
}

function getServerSnapshot(): null {
  return null;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatEveTime(at: Date): string {
  return `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`;
}

/** A minute count as `HH:MM` (e.g. 125 → `02:05`). */
function formatCountdown(mins: number): string {
  return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Player-population timezone blocs, east-to-west, as whole-hour UTC offsets from
// their westmost to eastmost edge (standard time — DST is not modelled).
const TZ_BLOCS = [
  { key: 'AU', minOffsetH: 8, maxOffsetH: 10 }, // Perth → Sydney (SEA overlaps)
  { key: 'EU', minOffsetH: 0, maxOffsetH: 3 }, // London → Moscow
  { key: 'US', minOffsetH: -8, maxOffsetH: -5 }, // Pacific → Eastern
] as const;

/** The wall-clock `Date` at `offsetH` hours from UTC, read via `getUTC*`. */
function wallClock(now: Date, offsetH: number): Date {
  return new Date(now.getTime() + offsetH * 3_600_000);
}

export type TimezoneRow = { key: string; weekday: string; range: string };

/** Per-bloc local weekday and wall-clock range for `now` (UTC). */
export function eveTimezoneRows(now: Date): TimezoneRow[] {
  return TZ_BLOCS.map(({ key, minOffsetH, maxOffsetH }) => {
    const low = wallClock(now, minOffsetH);
    const high = wallClock(now, maxOffsetH);
    return {
      key,
      weekday: WEEKDAYS[low.getUTCDay()]!,
      range: `${formatEveTime(low)} - ${formatEveTime(high)}`,
    };
  });
}

/**
 * Header widget showing the current EVE time (UTC) as `HH:MM`. In the hour
 * before CCP's daily downtime it turns orange and appends a `DT-Xm` countdown;
 * inside the downtime window it reads `Scheduled Downtime`. Clicking it opens a
 * popover with the current local time range for each major player timezone bloc.
 */
export function EveTimeClock() {
  const minute = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (minute === null) {
    return (
      <span
        className="mx-2 rounded-md border border-border px-2 py-0.5 font-mono text-sm text-muted-foreground tabular-nums"
        aria-hidden
      >
        EVE --:--
      </span>
    );
  }

  const now = new Date(minute * 60_000);
  const time = formatEveTime(now);
  const phase = eveClockPhase(now);
  const label =
    phase === 'downtime'
      ? 'Scheduled Downtime'
      : phase === 'pre'
        ? `DT-${minutesUntilDowntime(now)}m`
        : null;
  const rows = eveTimezoneRows(now);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              'mx-2 flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-sm tabular-nums',
              phase === 'normal'
                ? 'border-border text-muted-foreground'
                : 'border-amber-500/50 text-amber-600 dark:text-amber-400',
            )}
            title="EVE time (UTC)"
            aria-label={`EVE time ${time} UTC${label ? `, ${label}` : ''}`}
          >
            EVE {time}
            {label && <span>{label}</span>}
          </button>
        }
      />
      <PopoverContent className="w-auto p-2">
        <div className="mb-2 border-b pb-2 font-mono text-sm tabular-nums">
          Downtime in {formatCountdown(minutesUntilDowntime(now))}
        </div>
        <div className="flex flex-col gap-1 font-mono text-sm">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center gap-2 whitespace-nowrap">
              <span className="font-semibold">{r.key}</span>
              <span className="text-muted-foreground">{r.weekday}</span>
              <span className="tabular-nums">{r.range}</span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
