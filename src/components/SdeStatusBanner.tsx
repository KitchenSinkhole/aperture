'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SdeStatus } from '@/lib/sde/status';

/**
 * Static-data degraded banner: when the `universe_*` tables are behind what CCP
 * has published, the map is classifying jumps against a universe that no longer
 * matches the game, and every viewer needs to know rather than trusting it.
 * Renders nothing while healthy.
 */

const REFETCH_INTERVAL_MS = 900_000;

export function SdeStatusBanner({ initial }: { initial: SdeStatus }) {
  const [status, setStatus] = useState(initial);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch('/api/sde-status');
      if (!res.ok) return;
      const body = (await res.json()) as { ok: boolean; data?: SdeStatus };
      if (body.ok && body.data) setStatus(body.data);
    } catch {
      // A failed poll keeps the last known status on screen; the static-data
      // banner is not the place to report its own connectivity.
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => void refetch(), REFETCH_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refetch();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refetch]);

  if (status.state === 'ok') return null;

  const message =
    status.state === 'failing'
      ? 'Static data could not be updated. Recently added systems or gates may be missing.'
      : 'Static data is out of date. Recently added systems or gates may be missing.';

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-center text-sm text-amber-700 dark:text-amber-300"
    >
      {message}
    </div>
  );
}
