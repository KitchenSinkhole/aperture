import type React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// All hoisted above the imports that depend on them.

// Pulls a Server Action module (and with it Auth.js) into the graph; the
// connection block never renders it.
vi.mock('@/components/map/AddToRoutesItem', () => ({ AddToRoutesItem: () => null }));

// Base UI's menu primitives need a real popup lifecycle jsdom can't provide, so
// the menu chrome is stubbed down to plain elements; only which items render,
// and what clicking one does, is under test.
vi.mock('@base-ui/react/context-menu', async () => {
  const { createElement } = await import('react');
  const Root = ({ children, open }: { children?: React.ReactNode; open?: boolean }) =>
    open ? createElement('div', { 'data-slot': 'context-menu-root' }, children) : null;
  return { ContextMenu: { Root } };
});
vi.mock('@base-ui/react/menu', async () => {
  const { createElement } = await import('react');
  const passthrough =
    (slot: string) =>
    ({ children }: { children?: React.ReactNode }) =>
      createElement('div', { 'data-slot': slot }, children);
  return {
    Menu: {
      Portal: passthrough('menu-portal'),
      Positioner: passthrough('menu-positioner'),
      Popup: passthrough('menu-popup'),
    },
  };
});
vi.mock('@/components/ui/menu', async () => {
  const { createElement } = await import('react');
  const MenuItem = ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) =>
    createElement('div', { 'data-slot': 'menu-item', onClick }, children);
  const MenuCheckboxItem = ({
    children,
    checked,
    onCheckedChange,
  }: {
    children?: React.ReactNode;
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  }) =>
    createElement(
      'div',
      {
        'data-slot': 'menu-checkbox-item',
        'data-checked': checked ? '' : undefined,
        onClick: () => onCheckedChange?.(!checked),
      },
      children,
    );
  const passthrough =
    (slot: string) =>
    ({ children }: { children?: React.ReactNode }) =>
      createElement('div', { 'data-slot': slot }, children);
  return {
    MenuItem,
    MenuCheckboxItem,
    MenuSubmenu: passthrough('menu-submenu'),
    MenuSubmenuTrigger: passthrough('menu-submenu-trigger'),
    MenuSubmenuContent: passthrough('menu-submenu-content'),
    MenuRadioGroup: passthrough('menu-radio-group'),
    MenuRadioItem: passthrough('menu-radio-item'),
    MenuSeparator: () => createElement('hr', { 'data-slot': 'menu-separator' }),
  };
});

import { MapContextMenu } from '@/components/map/MapContextMenu';
import { isConnectionWatched, toggleConnectionWatch } from '@/lib/connectionWatchPrefs';
import type { MapConnectionEdge, MapContextMenuTarget } from '@/types';

const WH_ID = 'conn-wh';
const GATE_ID = 'conn-gate';

function connection(id: string, scope: MapConnectionEdge['scope']): MapConnectionEdge {
  return {
    id,
    source: 'node-a',
    target: 'node-b',
    scope,
    massStatus: 'fresh',
    jumpMassClass: null,
    eolStage: 'none',
    preserveMass: false,
    isRolling: false,
    isStatic: false,
    sourceBubbled: false,
    targetBubbled: false,
    eolAt: null,
    createdAt: '2026-09-22T00:00:00.000Z',
  };
}

const CONNECTIONS = [connection(WH_ID, 'wh'), connection(GATE_ID, 'stargate')];

// The watch store caches per map id, so each test claims its own.
let mapCounter = 0;

describe('Watch this wormhole (MapContextMenu connection block)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let mapId: string;
  let onClose: ReturnType<typeof vi.fn<() => void>>;

  function open(connectionId: string) {
    const target: MapContextMenuTarget = { kind: 'connection', id: connectionId, x: 10, y: 10 };
    act(() => {
      root.render(
        <MapContextMenu
          target={target}
          onClose={onClose}
          mapId={mapId}
          systems={[]}
          connections={CONNECTIONS}
          homeMapSystemId={null}
          selectedSystemIds={new Set()}
          onSystemPatch={vi.fn()}
          onSystemRemove={vi.fn()}
          onSystemRemoveSelected={vi.fn()}
          onConnectionPatch={vi.fn()}
          onConnectionDelete={vi.fn()}
          onAddSystemAt={vi.fn()}
          onDeleteSubchain={vi.fn()}
          onDeleteSubchainPick={vi.fn()}
          onDeleteDisconnected={vi.fn()}
          onPingSystem={vi.fn()}
          notes={[]}
          onAddNoteAt={vi.fn()}
          onNotePatch={vi.fn()}
          onNoteRemove={vi.fn()}
        />,
      );
    });
  }

  function watchItem(): HTMLElement | null {
    const items = Array.from(
      container.querySelectorAll('[data-slot="menu-checkbox-item"]'),
    ) as HTMLElement[];
    return items.find((el) => el.textContent === 'Watch this wormhole') ?? null;
  }

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    vi.clearAllMocks();
    localStorage.clear();
    mapId = `menu-map-${++mapCounter}`;
    onClose = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('offers the item for a wormhole connection', () => {
    open(WH_ID);
    expect(watchItem()).toBeTruthy();
  });

  it('does not offer the item for a stargate connection', () => {
    open(GATE_ID);
    expect(watchItem()).toBeNull();
  });

  it('keeps the item on a watched connection reclassified away from wh', () => {
    toggleConnectionWatch(mapId, GATE_ID);
    open(GATE_ID);
    expect(watchItem()).toBeTruthy();
    expect(watchItem()!.hasAttribute('data-checked')).toBe(true);
  });

  it('starts unchecked and watches the hole on click', () => {
    open(WH_ID);
    expect(watchItem()!.hasAttribute('data-checked')).toBe(false);
    act(() => watchItem()!.click());
    expect(isConnectionWatched(mapId, WH_ID)).toBe(true);
    expect(watchItem()!.hasAttribute('data-checked')).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('unwatches an already-watched hole on click', () => {
    open(WH_ID);
    act(() => watchItem()!.click());
    act(() => watchItem()!.click());
    expect(isConnectionWatched(mapId, WH_ID)).toBe(false);
    expect(watchItem()!.hasAttribute('data-checked')).toBe(false);
  });
});
