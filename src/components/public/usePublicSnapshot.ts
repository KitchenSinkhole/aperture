'use client';

import { useEffect, useState } from 'react';
import { apertureConfig } from '../../../aperture.config';
import { serverToClientMessageSchema } from '@/lib/realtime/protocol';
import type { PublicMapViewData } from '@/types';

/**
 * Keeps a spectator's redacted snapshot current. A token-pinned WebSocket
 * delivers a data-free `publicUpdate` nudge; the client schedules its refetch
 * a full `PUBLIC_SNAPSHOT_CACHE_TTL_MS` (plus jitter) later, which is what
 * guarantees the refetch lands on a cache entry created after the edit — any
 * shorter delay could be served a snapshot that predates it. Falls back to
 * polling when the socket can't be established or drops, and stops
 * permanently once the token no longer resolves (revoked, expired, or the
 * map itself removed) — the snapshot 404 is the one thing this hook trusts to
 * end the view; a server-side close (code 4001) only prompts a confirming
 * refetch.
 */

export type PublicFeedStatus = 'live' | 'polling' | 'ended';

export function usePublicSnapshot(
  token: string,
  initial: PublicMapViewData,
): { data: PublicMapViewData; status: PublicFeedStatus; updatedAt: number } {
  const [data, setData] = useState(initial);
  const [status, setStatus] = useState<PublicFeedStatus>('live');
  const [updatedAt, setUpdatedAt] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    let ended = false;
    let socket: WebSocket | null = null;
    let refetchTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;

    function stopPolling(): void {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    async function refetch(): Promise<void> {
      if (ended || document.visibilityState === 'hidden') return;
      const res = await fetch(`/api/public/${encodeURIComponent(token)}/snapshot`, {
        cache: 'no-store',
      }).catch(() => null);
      if (cancelled || !res) return;

      if (res.status === 404) {
        ended = true;
        setStatus('ended');
        stopPolling();
        if (reconnectTimer) clearTimeout(reconnectTimer);
        socket?.close();
        return;
      }
      if (!res.ok) return; // 429 or transient failure — keep the current schedule

      const json = (await res.json().catch(() => null)) as {
        ok: boolean;
        data?: PublicMapViewData;
      } | null;
      if (!json?.ok || !json.data) return;
      setData(json.data);
      setUpdatedAt(Date.now());
    }

    function scheduleRefetch(delayMs: number): void {
      if (refetchTimer) return; // one pending refetch at a time absorbs a burst of nudges
      refetchTimer = setTimeout(() => {
        refetchTimer = null;
        void refetch();
      }, delayMs);
    }

    function onNudge(): void {
      scheduleRefetch(
        apertureConfig.PUBLIC_SNAPSHOT_CACHE_TTL_MS +
          Math.random() * apertureConfig.PUBLIC_REFETCH_JITTER_MS,
      );
    }

    function startPolling(): void {
      if (ended || pollTimer) return;
      setStatus('polling');
      pollTimer = setInterval(() => void refetch(), apertureConfig.PUBLIC_POLL_INTERVAL_MS);
    }

    function connect(): void {
      if (ended) return;
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(
        `${scheme}://${window.location.host}${apertureConfig.WS_PUBLIC_PATH}?token=${encodeURIComponent(token)}`,
      );
      socket = ws;

      ws.onopen = () => {
        reconnectAttempts = 0;
        stopPolling();
        if (!ended) setStatus('live');
      };

      ws.onmessage = (event) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(typeof event.data === 'string' ? event.data : '');
        } catch {
          return;
        }
        const result = serverToClientMessageSchema.safeParse(parsed);
        if (result.success && result.data.task === 'publicUpdate') onNudge();
      };

      ws.onclose = (event) => {
        if (ended) return;
        startPolling();
        // A server-side revoke/delete closes with 4001 — a strong hint, but
        // the snapshot 404 is what actually ends the view.
        if (event.code === 4001) void refetch();
        const delay = Math.min(
          apertureConfig.WS_RECONNECT_BASE_MS * 2 ** reconnectAttempts,
          apertureConfig.WS_RECONNECT_MAX_MS,
        );
        reconnectAttempts += 1;
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => startPolling();
    }

    function onVisibilityChange(): void {
      if (document.visibilityState === 'visible' && !ended) void refetch();
    }

    connect();
    const idleTimer = setInterval(
      () => void refetch(),
      apertureConfig.PUBLIC_IDLE_REFRESH_MS,
    );
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stopPolling();
      clearInterval(idleTimer);
      if (refetchTimer) clearTimeout(refetchTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
    // `token` is the mount identity — a spectator page never swaps tokens
    // without a full navigation, and `initial` only seeds the initial state.
  }, [token]);

  return { data, status, updatedAt };
}
