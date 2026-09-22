import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SoundStatus } from '@/lib/sounds/engine';

// Must be called before the imports that depend on them — Vitest hoists vi.mock calls.

/** Mirrors the real engine's constant server snapshot. */
const SERVER_STATUS: SoundStatus = { unlocked: false, muted: false };

const engine = {
  status: { unlocked: false, muted: false } as SoundStatus,
  listeners: new Set<() => void>(),
  /** Resolves a tick later, as `AudioContext.resume()` does. */
  unlock: vi.fn(() => {
    if (engine.status.unlocked) return;
    void Promise.resolve().then(() => engine.set({ ...engine.status, unlocked: true }));
  }),
  toggleMute: vi.fn(() => engine.set({ ...engine.status, muted: !engine.status.muted })),
  set(next: SoundStatus) {
    engine.status = next;
    for (const l of engine.listeners) l();
  },
};

vi.mock('@/lib/sounds/engine', () => ({
  getSoundEngine: () => ({
    subscribe: (listener: () => void) => {
      engine.listeners.add(listener);
      return () => engine.listeners.delete(listener);
    },
    getSnapshot: () => engine.status,
    getServerSnapshot: () => SERVER_STATUS,
    unlock: engine.unlock,
    toggleMute: engine.toggleMute,
  }),
}));

// Base UI's tooltip needs portals and contexts jsdom can't provide; the trigger
// just renders whatever it was handed.
vi.mock('@base-ui/react/tooltip', async () => {
  const { createElement, Fragment } = await import('react');
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    createElement(Fragment, null, children);
  return {
    Tooltip: {
      Root: passthrough,
      Trigger: ({ render }: { render: React.ReactElement }) => render,
      Portal: () => null,
      Positioner: passthrough,
      Popup: passthrough,
    },
  };
});

vi.mock('@/components/ui/button', async () => {
  const { createElement } = await import('react');
  return {
    Button: ({
      children,
      onClick,
      onPointerDown,
      onKeyDown,
      'aria-label': ariaLabel,
    }: {
      children?: React.ReactNode;
      onClick?: () => void;
      onPointerDown?: () => void;
      onKeyDown?: () => void;
      'aria-label'?: string;
    }) =>
      createElement(
        'button',
        { type: 'button', onClick, onPointerDown, onKeyDown, 'aria-label': ariaLabel },
        children,
      ),
  };
});

import { SoundToolbarButton } from '@/components/map/SoundToolbarButton';

let container: HTMLDivElement;
let root: Root;
let documentGesture: (() => void) | null = null;

async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<SoundToolbarButton />);
  });
}

function button(): HTMLButtonElement {
  const el = container.querySelector('button');
  if (!el) throw new Error('button not rendered');
  return el;
}

/** A whole physical press: pointerdown, then the click it produces. */
async function press() {
  await act(async () => {
    button().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  });
  await act(async () => button().click());
}

beforeEach(() => {
  engine.status = { unlocked: false, muted: false };
  engine.listeners.clear();
  engine.unlock.mockClear();
  engine.toggleMute.mockClear();
  // The engine binds its own unlock to the document in the capture phase, so it
  // runs before any React handler on the same press (`src/lib/sounds/engine.ts`).
  documentGesture = () => engine.unlock();
  document.addEventListener('pointerdown', documentGesture, true);
});

afterEach(async () => {
  if (documentGesture) document.removeEventListener('pointerdown', documentGesture, true);
  documentGesture = null;
  await act(async () => root.unmount());
  container.remove();
});

describe('SoundToolbarButton', () => {
  it('offers the unlock while audio is locked, and does not mute', async () => {
    await render();
    expect(button().getAttribute('aria-label')).toBe('Click to enable sounds');

    await press();

    expect(engine.toggleMute).not.toHaveBeenCalled();
    expect(engine.status.muted).toBe(false);
    expect(engine.status.unlocked).toBe(true);
  });

  it('does not mute when the document gesture unlocks mid-press', async () => {
    await render();

    await act(async () => {
      button().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    // The press has already unlocked audio and re-rendered the button live; the
    // click that follows belongs to the gesture that started while locked.
    expect(button().getAttribute('aria-label')).toContain('click to mute');

    await act(async () => button().click());

    expect(engine.toggleMute).not.toHaveBeenCalled();
    expect(engine.status.muted).toBe(false);
  });

  it('toggles the device mute once unlocked', async () => {
    engine.status = { unlocked: true, muted: false };
    await render();
    expect(button().getAttribute('aria-label')).toContain('click to mute');

    await press();

    expect(engine.toggleMute).toHaveBeenCalledTimes(1);
    expect(engine.status.muted).toBe(true);
  });

  it('reads muted while unlocked and muted, and unmutes on a press', async () => {
    engine.status = { unlocked: true, muted: true };
    await render();
    expect(button().getAttribute('aria-label')).toContain('click to unmute');

    await press();

    expect(engine.toggleMute).toHaveBeenCalledTimes(1);
    expect(engine.status.muted).toBe(false);
  });

  it('follows a status change pushed from elsewhere', async () => {
    await render();
    expect(button().getAttribute('aria-label')).toBe('Click to enable sounds');

    await act(async () => engine.set({ unlocked: true, muted: true }));

    expect(button().getAttribute('aria-label')).toContain('click to unmute');
  });

  it('renders the locked state on the server, whatever this device knows', async () => {
    engine.status = { unlocked: true, muted: true };
    await render();
    const { renderToString } = await import('react-dom/server');
    const html = renderToString(<SoundToolbarButton />);

    expect(html).toContain('Click to enable sounds');
  });
});
