import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Must be called before the imports that depend on them — Vitest hoists vi.mock calls.
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/character/client', () => ({ setWaypointOnServer: vi.fn() }));
vi.mock('@/components/map/MapActiveCharContext', () => ({ useMapActiveChar: vi.fn() }));
// Stub Base UI menu primitives — they require a Menu.Root context which jsdom can't provide.
vi.mock('@/components/ui/menu', async () => {
  const { createElement } = await import('react');
  const MenuItem = ({ children, disabled, onClick, className }: {
    children?: React.ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    className?: string;
    icon?: React.ReactNode;
  }) =>
    createElement(
      'div',
      { 'data-slot': 'menu-item', 'data-disabled': disabled ? '' : undefined, onClick, className },
      children,
    );
  const MenuSubmenu = ({ children }: { children?: React.ReactNode }) =>
    createElement('div', { 'data-slot': 'menu-submenu' }, children);
  const MenuSubmenuTrigger = ({ children, icon }: { children?: React.ReactNode; icon?: React.ReactNode }) =>
    createElement('div', { 'data-slot': 'menu-submenu-trigger' }, icon, children);
  const MenuSubmenuContent = ({ children }: { children?: React.ReactNode }) =>
    createElement('div', { 'data-slot': 'menu-submenu-content' }, children);
  const MenuSeparator = () => createElement('hr', { 'data-slot': 'menu-separator' });
  return { MenuItem, MenuSubmenu, MenuSubmenuTrigger, MenuSubmenuContent, MenuSeparator };
});

import { toast } from 'sonner';
import { setWaypointOnServer } from '@/lib/character/client';
import { useMapActiveChar } from '@/components/map/MapActiveCharContext';
import {
  applyWaypointFanOutResult,
  SetDestinationItem,
} from '@/components/map/SetDestinationItem';
import type { MapSystemNode } from '@/types';

const mockSetWaypoint = vi.mocked(setWaypointOnServer);
const mockUseMapActiveChar = vi.mocked(useMapActiveChar);

// Minimal fixture with all required MapSystemNode fields.
const SYSTEM: MapSystemNode = {
  id: 'node-1',
  systemId: 30000142,
  name: 'Jita',
  alias: null,
  tag: null,
  intelNotes: null,
  status: 'unknown',
  security: 'H',
  trueSec: 0.9,
  effect: null,
  regionName: 'The Forge',
  constellationName: 'Kimotoro',
  statics: [],
  staticTypeIds: [],
  tradeHub: null,
  locked: false,
  rallyAt: null,
  positionX: 0,
  positionY: 0,
};

const SYSTEM_WITH_ALIAS: MapSystemNode = { ...SYSTEM, alias: 'Home' };

function makeCtx(
  locatedChars: { id: number; name: string }[],
  activeCharId: number | null = null,
) {
  return { activeCharId, activeCharSystemId: null, locatedChars, setPickedCharId: vi.fn() };
}

// ---------------------------------------------------------------------------
// Pure function: applyWaypointFanOutResult
// ---------------------------------------------------------------------------

describe('applyWaypointFanOutResult', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fires error toast when 0 of 2 succeed', () => {
    applyWaypointFanOutResult(0, 2);
    expect(toast.error).toHaveBeenCalledWith('Failed to set destination for any character');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('fires error toast when 0 of 3 succeed', () => {
    applyWaypointFanOutResult(0, 3);
    expect(toast.error).toHaveBeenCalledWith('Failed to set destination for any character');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('fires "all 2" success toast when 2 of 2 succeed', () => {
    applyWaypointFanOutResult(2, 2);
    expect(toast.success).toHaveBeenCalledWith('Destination set for all 2 characters');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('fires "all 3" success toast when 3 of 3 succeed', () => {
    applyWaypointFanOutResult(3, 3);
    expect(toast.success).toHaveBeenCalledWith('Destination set for all 3 characters');
  });

  it('fires partial toast when 1 of 2 succeed', () => {
    applyWaypointFanOutResult(1, 2);
    expect(toast.success).toHaveBeenCalledWith('Destination set for 1 of 2 characters');
  });

  it('fires partial toast when 2 of 3 succeed', () => {
    applyWaypointFanOutResult(2, 3);
    expect(toast.success).toHaveBeenCalledWith('Destination set for 2 of 3 characters');
  });
});

// ---------------------------------------------------------------------------
// Structural rendering: which branch renders for each char count
// ---------------------------------------------------------------------------

describe('SetDestinationItem — structural rendering', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('0 chars: renders a disabled flat menu item, no submenu trigger', () => {
    mockUseMapActiveChar.mockReturnValue(makeCtx([]));
    act(() => {
      root.render(<SetDestinationItem system={SYSTEM} onClose={vi.fn()} />);
    });
    const item = container.querySelector('[data-slot="menu-item"]');
    expect(item).toBeTruthy();
    expect(item?.hasAttribute('data-disabled')).toBe(true);
    expect(container.querySelector('[data-slot="menu-submenu-trigger"]')).toBeNull();
  });

  it('1 char: renders a flat menu item, no submenu trigger', () => {
    mockUseMapActiveChar.mockReturnValue(makeCtx([{ id: 1, name: 'Alpha' }], 1));
    act(() => {
      root.render(<SetDestinationItem system={SYSTEM} onClose={vi.fn()} />);
    });
    expect(container.querySelector('[data-slot="menu-item"]')).toBeTruthy();
    expect(container.querySelector('[data-slot="menu-submenu-trigger"]')).toBeNull();
  });

  it('2 chars: renders a submenu trigger', () => {
    mockUseMapActiveChar.mockReturnValue(
      makeCtx([{ id: 1, name: 'Alpha' }, { id: 2, name: 'Bravo' }], 1),
    );
    act(() => {
      root.render(<SetDestinationItem system={SYSTEM} onClose={vi.fn()} />);
    });
    expect(container.querySelector('[data-slot="menu-submenu-trigger"]')).toBeTruthy();
  });

  it('3 chars: renders a submenu trigger', () => {
    mockUseMapActiveChar.mockReturnValue(
      makeCtx(
        [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Bravo' }, { id: 3, name: 'Charlie' }],
        1,
      ),
    );
    act(() => {
      root.render(<SetDestinationItem system={SYSTEM} onClose={vi.fn()} />);
    });
    expect(container.querySelector('[data-slot="menu-submenu-trigger"]')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 1-char interaction: API call, toast, onClose
// ---------------------------------------------------------------------------

describe('SetDestinationItem — 1-char interaction', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    vi.clearAllMocks();
    mockUseMapActiveChar.mockReturnValue(makeCtx([{ id: 1, name: 'Alpha' }], 1));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('calls setWaypointOnServer with the located char and system id', async () => {
    mockSetWaypoint.mockResolvedValue({ ok: true });
    act(() => {
      root.render(<SetDestinationItem system={SYSTEM} onClose={vi.fn()} />);
    });
    act(() => {
      (container.querySelector('[data-slot="menu-item"]') as HTMLElement).click();
    });
    expect(mockSetWaypoint).toHaveBeenCalledWith({ characterId: 1, destinationId: 30000142 });
  });

  it('toasts success with the system name when ok: true', async () => {
    mockSetWaypoint.mockResolvedValue({ ok: true });
    act(() => {
      root.render(<SetDestinationItem system={SYSTEM} onClose={vi.fn()} />);
    });
    act(() => {
      (container.querySelector('[data-slot="menu-item"]') as HTMLElement).click();
    });
    await act(async () => {});
    expect(toast.success).toHaveBeenCalledWith('Waypoint set to Jita');
  });

  it('uses alias instead of name in the toast when alias is set', async () => {
    mockSetWaypoint.mockResolvedValue({ ok: true });
    act(() => {
      root.render(<SetDestinationItem system={SYSTEM_WITH_ALIAS} onClose={vi.fn()} />);
    });
    act(() => {
      (container.querySelector('[data-slot="menu-item"]') as HTMLElement).click();
    });
    await act(async () => {});
    expect(toast.success).toHaveBeenCalledWith('Waypoint set to Home');
  });

  it('does not call toast.success when ok: false', async () => {
    mockSetWaypoint.mockResolvedValue({ ok: false, error: 'ESI error' });
    act(() => {
      root.render(<SetDestinationItem system={SYSTEM} onClose={vi.fn()} />);
    });
    act(() => {
      (container.querySelector('[data-slot="menu-item"]') as HTMLElement).click();
    });
    await act(async () => {});
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('calls onClose synchronously on click', () => {
    mockSetWaypoint.mockResolvedValue({ ok: true });
    const onClose = vi.fn();
    act(() => {
      root.render(<SetDestinationItem system={SYSTEM} onClose={onClose} />);
    });
    act(() => {
      (container.querySelector('[data-slot="menu-item"]') as HTMLElement).click();
    });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// 2-char interaction: fan-out, toasts, onClose, individual char entries
// ---------------------------------------------------------------------------

describe('SetDestinationItem — multi-char interaction', () => {
  let container: HTMLDivElement;
  let root: Root;
  const TWO_CHARS = [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }];

  /** Returns all [data-slot="menu-item"] elements inside the submenu content. */
  function submenuItems(): HTMLElement[] {
    const content = container.querySelector('[data-slot="menu-submenu-content"]')!;
    return Array.from(content.querySelectorAll('[data-slot="menu-item"]')) as HTMLElement[];
  }

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('A: "All characters" fan-out calls setWaypointOnServer for each located char', async () => {
    mockUseMapActiveChar.mockReturnValue(makeCtx(TWO_CHARS, 1));
    mockSetWaypoint.mockResolvedValue({ ok: true });
    act(() => {
      root.render(<SetDestinationItem system={SYSTEM} onClose={vi.fn()} />);
    });
    act(() => {
      submenuItems()[0]!.click(); // "All characters" is first item
    });
    await act(async () => {});
    expect(mockSetWaypoint).toHaveBeenCalledTimes(2);
    expect(mockSetWaypoint).toHaveBeenCalledWith({ characterId: 1, destinationId: 30000142 });
    expect(mockSetWaypoint).toHaveBeenCalledWith({ characterId: 2, destinationId: 30000142 });
  });

  it('B: "All characters" calls applyWaypointFanOutResult with correct counts (1 of 2)', async () => {
    mockUseMapActiveChar.mockReturnValue(makeCtx(TWO_CHARS, 1));
    mockSetWaypoint
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: 'ESI error' });
    act(() => {
      root.render(<SetDestinationItem system={SYSTEM} onClose={vi.fn()} />);
    });
    act(() => {
      submenuItems()[0]!.click();
    });
    await act(async () => {});
    expect(toast.success).toHaveBeenCalledWith('Destination set for 1 of 2 characters');
  });

  it('C: "All characters" calls onClose synchronously', () => {
    mockUseMapActiveChar.mockReturnValue(makeCtx(TWO_CHARS, 1));
    mockSetWaypoint.mockResolvedValue({ ok: true });
    const onClose = vi.fn();
    act(() => {
      root.render(<SetDestinationItem system={SYSTEM} onClose={onClose} />);
    });
    act(() => {
      submenuItems()[0]!.click();
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('D: individual char entry calls setWaypointOnServer with that char\'s id', async () => {
    mockUseMapActiveChar.mockReturnValue(makeCtx(TWO_CHARS, 1));
    mockSetWaypoint.mockResolvedValue({ ok: true });
    act(() => {
      root.render(<SetDestinationItem system={SYSTEM} onClose={vi.fn()} />);
    });
    // submenuItems: [0] = "All characters", [1] = Alpha, [2] = Beta
    act(() => {
      submenuItems()[2]!.click(); // "Beta" — id: 2
    });
    await act(async () => {});
    expect(mockSetWaypoint).toHaveBeenCalledWith({ characterId: 2, destinationId: 30000142 });
  });

  it('E: individual char entry calls onClose synchronously', () => {
    mockUseMapActiveChar.mockReturnValue(makeCtx(TWO_CHARS, 1));
    mockSetWaypoint.mockResolvedValue({ ok: true });
    const onClose = vi.fn();
    act(() => {
      root.render(<SetDestinationItem system={SYSTEM} onClose={onClose} />);
    });
    act(() => {
      submenuItems()[1]!.click(); // "Alpha" — first char entry
    });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
