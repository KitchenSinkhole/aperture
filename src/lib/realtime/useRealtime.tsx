'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { apertureConfig } from '../../../aperture.config';
import {
  envelopeSchema,
  healthCheckLoadSchema,
  type BlackoutStatus,
  type Envelope,
} from './protocol';

/**
 * Client-side realtime façade. Boots the SharedWorker (one socket per origin),
 * exposes the connection status, lets a page subscribe / unsubscribe to map
 * channels, and fans every inbound envelope out to registered listeners.
 *
 * Envelopes are delivered through a synchronous listener registry, NOT through
 * React state: each parsed envelope invokes every listener immediately in
 * `port.onmessage`. This is deliberate — routing envelopes through a single
 * `useState` slot would coalesce a same-tick burst (React batches state
 * updates) down to the last one, silently dropping the intermediate events.
 * The registry delivers all N. The façade still does NOT merge events into the
 * xyflow canvas; consumers subscribe via `useRealtimeEvents` and own the apply.
 *
 * Degraded mode: the banner must never render silently stale.
 * `status` reflects the worker's socket state AND a staleness watchdog — if no
 * traffic (including the server heartbeat) arrives within WS_HEALTH_STALE_MS we
 * force `degraded` even if the socket believes it is open.
 */

export type RealtimeStatus = 'connecting' | 'open' | 'closed' | 'degraded';

type RealtimeContextValue = {
  status: RealtimeStatus;
  /** The latest `healthCheck.blackout` this tab has received; null until the first one. */
  blackout: BlackoutStatus | null;
  subscribe: (mapId: number) => void;
  unsubscribe: (mapId: number) => void;
  /** Register an envelope listener; returns an unsubscribe fn. Stable identity. */
  subscribeToEvents: (listener: (env: Envelope) => void) => () => void;
};

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

type WorkerOutbound =
  | { type: 'status'; status: RealtimeStatus }
  | { type: 'message'; envelope: Envelope };

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const [blackout, setBlackout] = useState<BlackoutStatus | null>(null);
  // Envelope listeners, invoked synchronously per inbound frame. Kept off React
  // state so a same-tick burst delivers every event, not just the last.
  const listenersRef = useRef<Set<(env: Envelope) => void>>(new Set());
  const portRef = useRef<MessagePort | null>(null);
  const lastSeenRef = useRef<number>(0);
  const socketStatusRef = useRef<RealtimeStatus>('connecting');
  // Maps the page wants subscribed. Effects run child-before-parent, so a map
  // page's `useMapSubscription` fires before this provider's effect sets
  // `portRef`. We record the intent here and flush it once the port exists.
  const desiredRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    lastSeenRef.current = Date.now();

    if (typeof SharedWorker === 'undefined') {
      // Safari / unsupported: realtime is unavailable; render degraded, never stale.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time capability fallback, no external source to subscribe to
      setStatus('degraded');
      return;
    }

    const worker = new SharedWorker(new URL('./sharedWorker.ts', import.meta.url), {
      type: 'module',
      name: 'aperture-realtime',
    });
    const port = worker.port;
    portRef.current = port;

    port.onmessage = (e: MessageEvent<WorkerOutbound>) => {
      lastSeenRef.current = Date.now();
      const data = e.data;
      if (data.type === 'status') {
        socketStatusRef.current = data.status;
        setStatus(data.status);
      } else {
        const result = envelopeSchema.safeParse(data.envelope);
        if (!result.success) return;
        if (result.data.task === 'healthCheck') {
          const health = healthCheckLoadSchema.safeParse(result.data.load);
          // A healthCheck without `blackout` keeps the current value.
          const next = health.success ? health.data.blackout : undefined;
          if (next) setBlackout((prev) => (sameBlackout(prev, next) ? prev : next));
        }
        for (const l of listenersRef.current) l(result.data);
      }
    };
    port.start();

    // Flush subscriptions requested before the port was ready (effect ordering).
    for (const mapId of desiredRef.current) {
      port.postMessage({ type: 'subscribe', mapId });
    }

    const watchdog = setInterval(() => {
      const stale = Date.now() - lastSeenRef.current > apertureConfig.WS_HEALTH_STALE_MS;
      if (stale && socketStatusRef.current === 'open') setStatus('degraded');
    }, Math.min(apertureConfig.WS_HEALTH_STALE_MS, 10_000));

    return () => {
      clearInterval(watchdog);
      port.close();
      portRef.current = null;
    };
  }, []);

  const subscribe = useCallback((mapId: number) => {
    desiredRef.current.add(mapId);
    portRef.current?.postMessage({ type: 'subscribe', mapId });
  }, []);

  const unsubscribe = useCallback((mapId: number) => {
    desiredRef.current.delete(mapId);
    portRef.current?.postMessage({ type: 'unsubscribe', mapId });
  }, []);

  const subscribeToEvents = useCallback((listener: (env: Envelope) => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  // Value changes only when `status` or the Blackout standing changes, never
  // per envelope (events flow through the listener registry instead).
  const value = useMemo<RealtimeContextValue>(
    () => ({ status, blackout, subscribe, unsubscribe, subscribeToEvents }),
    [status, blackout, subscribe, unsubscribe, subscribeToEvents],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

/** Access the realtime connection. Throws if used outside {@link RealtimeProvider}. */
export function useRealtime(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error('useRealtime must be used within a RealtimeProvider');
  return ctx;
}

function sameBlackout(a: BlackoutStatus | null, b: BlackoutStatus): boolean {
  return a !== null && a.active === b.active && a.since === b.since && a.cleared === b.cleared;
}

/**
 * The viewer's live standing under Blackout: the latest `healthCheck.blackout`,
 * or `initial` (the page load's / resync snapshot's value) until the first one
 * arrives. A tab joining an already-running SharedWorker otherwise waits a
 * full heartbeat for it.
 */
export function useBlackoutStatus(initial: BlackoutStatus): BlackoutStatus {
  return useRealtime().blackout ?? initial;
}

/** Subscribe to one map for the lifetime of the calling component. */
export function useMapSubscription(mapId: number | null): void {
  const { subscribe, unsubscribe } = useRealtime();
  useEffect(() => {
    if (mapId == null) return;
    subscribe(mapId);
    return () => unsubscribe(mapId);
  }, [mapId, subscribe, unsubscribe]);
}

/**
 * Run `listener` for every inbound realtime envelope, exactly once each, in
 * arrival order — including same-tick bursts that a `useState` slot would
 * coalesce. The listener may change every render without re-subscribing (held
 * in a ref); the underlying subscription is stable for the component's lifetime.
 */
export function useRealtimeEvents(listener: (env: Envelope) => void): void {
  const { subscribeToEvents } = useRealtime();
  const ref = useRef(listener);
  // Keep the latest listener without re-subscribing each render (matches the
  // `useTraversals` ref pattern). Updated in an effect — refs must not be
  // written during render.
  useEffect(() => {
    ref.current = listener;
  });
  useEffect(() => subscribeToEvents((env) => ref.current(env)), [subscribeToEvents]);
}

/**
 * Fire `onReconnect` when the socket returns to `open` after having been
 * disconnected — NOT on the initial mount-open (the page-load snapshot is
 * already fresh, so there is nothing to recover). A real drop passes through
 * `degraded`/`closed` before re-opening, which arms the resync; `connecting` is
 * the pre-open state and is ignored so the initial `connecting → open` can never
 * trigger a fetch. Closes the reconnect-backfill gap: the SharedWorker resumes
 * only NEW events on reconnect, so the canvas must refetch to recover the gap.
 */
export function useReconnectResync(onReconnect: () => void): void {
  const { status } = useRealtime();
  const wasDisconnectedRef = useRef(false);
  const ref = useRef(onReconnect);
  // Keep the latest callback without re-running the transition effect — the
  // effect depends on `status` only (same ref pattern as `useRealtimeEvents`).
  useEffect(() => {
    ref.current = onReconnect;
  });
  useEffect(() => {
    if (status === 'degraded' || status === 'closed') {
      wasDisconnectedRef.current = true;
    } else if (status === 'open' && wasDisconnectedRef.current) {
      wasDisconnectedRef.current = false;
      ref.current();
    }
  }, [status]);
}
