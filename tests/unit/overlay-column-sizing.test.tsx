import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import {
  OVERLAY_COLUMN_WIDTHS_KEY,
  writeOverlayColumnFractions,
} from '@/lib/map/overlayColumnPrefs';
import type { MapPresenceEntry, MapViewData } from '@/types';

const roster: MapPresenceEntry[] = [1, 2].map((n) => ({
  userId: n,
  characterId: n,
  characterName: `Pilot ${n}`,
  mainCharacterId: null,
  mainCharacterName: null,
  systemId: 31000001,
  systemName: 'J123456',
  systemSecurity: 'C3',
  systemTrueSec: -0.9,
  shipTypeId: 670,
  shipTypeName: 'Capsule',
  shipClass: 'capsule',
  shipName: `Pod ${n}`,
  locationAt: '2026-08-27T00:00:00Z',
})) as MapPresenceEntry[];

vi.mock('@/components/map/MapActiveCharContext', () => ({
  useMapActiveChar: () => ({ activeCharId: 99, activeCharSystemId: 31000001 }),
}));

vi.mock('@/components/map/MapPresenceContext', () => ({
  usePresenceForSystem: () => roster,
}));

vi.mock('@/lib/map/client', () => ({
  pingSystemOnServer: vi.fn(),
  updateSystemOnServer: vi.fn(),
}));

const { SystemOverlay } = await import('@/components/map/SystemOverlay');

const viewData: MapViewData = {
  map: {
    id: 'map-1',
    name: 'Home',
    scope: 'wh',
    type: 'corp',
    tagScheme: 'none',
    homeMapSystemId: null,
  },
  systems: [],
  connections: [],
  signatures: [],
  notes: [],
  presence: roster,
};

// ---------------------------------------------------------------------------
// Harness: jsdom lays nothing out, so the wrapper's width and the ResizeObserver
// that watches it are both driven by hand.
// ---------------------------------------------------------------------------

let wrapWidth = 320;
const observed = new Set<() => void>();

class FakeResizeObserver {
  constructor(private readonly cb: () => void) {}
  observe() {
    observed.add(this.cb);
  }
  disconnect() {
    observed.delete(this.cb);
  }
  unobserve() {}
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
  Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', {
    get: () => wrapWidth,
    configurable: true,
  });
  localStorage.clear();
  wrapWidth = 320;
  observed.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(): void {
  act(() => {
    root.render(<SystemOverlay viewData={viewData} fitOverflow="truncate_cascade" />);
  });
}

function resizeTo(width: number): void {
  wrapWidth = width;
  act(() => {
    for (const cb of observed) cb();
  });
}

function colWidths(): number[] {
  return Array.from(container.querySelectorAll('colgroup col')).map((col) =>
    Number.parseFloat((col as HTMLElement).style.width),
  );
}

function menuButton(): HTMLButtonElement {
  const button = container.querySelector('button[aria-haspopup="menu"]');
  if (!button) throw new Error('column menu button not rendered');
  return button as HTMLButtonElement;
}

function openMenu(): void {
  act(() => {
    menuButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function menuItems(): HTMLButtonElement[] {
  return Array.from(
    document.body.querySelectorAll('[role="menuitem"]'),
  ) as HTMLButtonElement[];
}

function clickMenuItem(label: string): void {
  const item = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find(
    (el) => el.textContent === label,
  );
  if (!item) throw new Error(`no menu item ${label}`);
  act(() => {
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function pressEscape(): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
}

describe('overlay pilot column sizing', () => {
  it('splits the pool by the stored fractions', () => {
    writeOverlayColumnFractions({ pilot: 0.5, name: 0.25 });
    render();
    // 320px wrapper less the 28px icon column leaves a 292px pool.
    expect(colWidths().slice(0, 2)).toEqual([146, 73]);
  });

  it('holds proportions when the window is resized', () => {
    writeOverlayColumnFractions({ pilot: 0.5, name: 0.25 });
    render();
    resizeTo(640);
    expect(colWidths().slice(0, 2)).toEqual([306, 153]);
  });

  it('does not rewrite storage on a resize', () => {
    writeOverlayColumnFractions({ pilot: 0.5, name: 0.25 });
    render();
    resizeTo(640);
    expect(JSON.parse(localStorage.getItem(OVERLAY_COLUMN_WIDTHS_KEY)!)).toEqual({
      pilot: 0.5,
      name: 0.25,
    });
  });

  it('gives every column an equal share on Even', () => {
    writeOverlayColumnFractions({ pilot: 0.5, name: 0.25 });
    render();
    openMenu();
    clickMenuItem('Even');
    expect(colWidths().slice(0, 2)).toEqual([97, 97]);
  });

  it('returns to the opening proportions on Reset', () => {
    writeOverlayColumnFractions({ pilot: 0.5, name: 0.25 });
    render();
    const opening = colWidths();
    openMenu();
    clickMenuItem('Even');
    expect(colWidths()).not.toEqual(opening);
    openMenu();
    clickMenuItem('Reset');
    expect(colWidths()).toEqual(opening);
  });

  it('opens the menu on a plain click, with no gesture to learn', () => {
    render();
    expect(menuItems()).toHaveLength(0);
    openMenu();
    expect(menuItems().map((item) => item.textContent)).toEqual(['Reset', 'Fit', 'Even']);
  });

  it('changes nothing by merely opening the menu', () => {
    writeOverlayColumnFractions({ pilot: 0.5, name: 0.25 });
    render();
    const before = colWidths();
    openMenu();
    expect(colWidths()).toEqual(before);
  });

  it('focuses the first item so the keyboard can reach every action', () => {
    render();
    openMenu();
    expect(document.activeElement).toBe(menuItems()[0]);
  });

  it('closes on Escape and hands focus back to the button', () => {
    render();
    openMenu();
    pressEscape();
    expect(menuItems()).toHaveLength(0);
    expect(document.activeElement).toBe(menuButton());
  });

  it('toggles shut when the button is clicked again', () => {
    render();
    openMenu();
    openMenu();
    expect(menuItems()).toHaveLength(0);
  });
});
