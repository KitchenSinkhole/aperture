'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';

// A spectator arriving from a stream overlay or a pasted link has no idea what
// they are looking at. One card says it, then gets out of the way for good.

const DISMISSED_KEY = 'aperture:spectator:intro';

// The dismissal is a client-only value, read through `useSyncExternalStore` so
// the server renders the dismissed state and hydration never mismatches. A
// returning visitor sees nothing rather than a card that flashes and vanishes.
const listeners = new Set<() => void>();
let cached: boolean | null = null;

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function isDismissed(): boolean {
  if (cached === null) {
    try {
      cached = window.localStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      cached = false;
    }
  }
  return cached;
}

function isDismissedOnServer(): boolean {
  return true;
}

function dismiss(): void {
  cached = true;
  try {
    window.localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // A blocked storage quota shouldn't keep the card on screen this session.
  }
  for (const listener of listeners) listener();
}

export function IntroCard() {
  const dismissed = useSyncExternalStore(subscribe, isDismissed, isDismissedOnServer);
  if (dismissed) return null;

  return (
    <aside className="pointer-events-auto max-w-sm rounded-md border border-spec-line bg-spec-rail/95 p-4 shadow-xl backdrop-blur">
      <div className="flex items-start gap-3">
        <div className="min-w-0">
          <h2 className="font-spec-mono text-xs uppercase tracking-[0.18em] text-spec-dim">
            What am I looking at?
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-spec-text">
            A live wormhole chain, shared read-only. Aperture is a collaborative mapping tool for
            EVE Online: corps chart short-lived chains together, and every viewer sees the same map
            update as it is scanned.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-spec-dim">
            The board on the left lists the k-space entrances and the signature to scan in each, so
            you can find your own way in.
          </p>
          <Link
            href="/"
            className="mt-3 inline-block font-spec-mono text-xs text-spec-text underline underline-offset-4"
          >
            Map your own chain
          </Link>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="-mr-1 -mt-1 shrink-0 rounded-sm p-1 text-spec-dim transition-colors hover:text-spec-text"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </aside>
  );
}
