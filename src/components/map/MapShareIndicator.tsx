'use client';

import { useEffect, useState } from 'react';
import { Radio } from 'lucide-react';
import type { LiveShareBadge } from '@/types';

/** How often the badge re-checks whether a timed share has run out. */
const EXPIRY_SWEEP_MS = 30_000;

function stillLive(share: LiveShareBadge, now: number): boolean {
  return share.expiresAt === null || new Date(share.expiresAt).getTime() > now;
}

/**
 * The "this map is published" badge. Rendered for every viewer, not just the
 * managers who can mint links — the people whose chain is on the wire are the
 * ones who need to know.
 */
export function MapShareIndicator({ shares }: { shares: LiveShareBadge[] }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), EXPIRY_SWEEP_MS);
    return () => clearInterval(timer);
  }, []);

  const live = shares.filter((s) => stillLive(s, now));
  if (live.length === 0) return null;

  const labels = live.map((s) => s.label).join(', ');
  return (
    <span
      title={
        live.length === 1
          ? `Published publicly as “${labels}”`
          : `Published publicly as: ${labels}`
      }
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400"
    >
      <Radio className="size-3.5" />
      {live.length === 1 ? 'Public share live' : `${live.length} public shares live`}
    </span>
  );
}
