'use client';

import { useEffect, useState } from 'react';

const TICK_MS = 60_000;

const listeners = new Set<() => void>();
let refCount = 0;
let timer: ReturnType<typeof setInterval> | undefined;

function startTimer() {
  if (timer != null) return;
  timer = setInterval(() => {
    for (const l of listeners) l();
  }, TICK_MS);
}

function stopTimer() {
  if (timer == null) return;
  clearInterval(timer);
  timer = undefined;
}

/** One shared minute cadence for EOL countdown surfaces on the map. */
export function subscribeMapMinuteTick(listener: () => void): () => void {
  listeners.add(listener);
  refCount += 1;
  startTimer();
  return () => {
    listeners.delete(listener);
    refCount -= 1;
    if (refCount <= 0) stopTimer();
  };
}

/** Re-renders at most once per minute while mounted. */
export function useMapMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => subscribeMapMinuteTick(() => setNow(Date.now())), []);
  return now;
}
