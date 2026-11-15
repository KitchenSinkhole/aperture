import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlackoutStatus, ConnectionMassLogEntry, MapPresenceEntry } from '@/types';
import type { MapConnectionEdge } from '@/lib/map/loadMap';

const fetchConnectionMassLog = vi.fn();
let realtimeBlackout: BlackoutStatus | null = null;

vi.mock('@/lib/map/client', () => ({
  fetchConnectionMassLog: (...args: unknown[]) => fetchConnectionMassLog(...args),
}));
vi.mock('@/lib/realtime/useRealtime', () => ({
  useRealtime: () => ({ blackout: realtimeBlackout }),
  useRealtimeEvents: () => {},
}));
// Base UI's tooltip needs portals and contexts jsdom can't provide: the stub
// opens on mount and renders the popup inline.
vi.mock('@base-ui/react/tooltip', async () => {
  const { createElement, Fragment, useEffect } = await import('react');
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    createElement(Fragment, null, children);
  return {
    Tooltip: {
      Root: ({
        children,
        onOpenChange,
      }: {
        children?: React.ReactNode;
        onOpenChange?: (open: boolean) => void;
      }) => {
        useEffect(() => onOpenChange?.(true), []); // eslint-disable-line react-hooks/exhaustive-deps
        return createElement(Fragment, null, children);
      },
      Trigger: passthrough,
      Portal: passthrough,
      Positioner: passthrough,
      Popup: passthrough,
    },
  };
});

const { BlackoutBanner } = await import('@/components/map/BlackoutBanner');
const { PilotRoster } = await import('@/components/map/PilotRoster');
const { ConnectionMassLog } = await import('@/components/sidebar/ConnectionMassLog');
const { ConnectionDetailPopover } = await import('@/components/map/ConnectionDetailPopover');

const SINCE = '2026-10-23T18:42:00.000Z';
const OFF: BlackoutStatus = { active: false, since: null, cleared: false };
const ON_RESTRICTED: BlackoutStatus = { active: true, since: SINCE, cleared: false };
const ON_CLEARED: BlackoutStatus = { active: true, since: SINCE, cleared: true };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  fetchConnectionMassLog.mockReset();
  realtimeBlackout = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(ui: React.ReactElement): Promise<void> {
  await act(async () => {
    root.render(ui);
  });
}

describe('BlackoutBanner', () => {
  it('renders nothing while Blackout is off', async () => {
    await render(<BlackoutBanner blackout={OFF} />);
    expect(container.innerHTML).toBe('');
  });

  it('tells a restricted viewer that pilots are hidden but their own characters show', async () => {
    await render(<BlackoutBanner blackout={ON_RESTRICTED} />);
    const banner = container.querySelector('[role="status"]');
    expect(banner?.getAttribute('data-blackout')).toBe('restricted');
    expect(banner?.textContent).toContain('Blackout in effect.');
    expect(banner?.textContent).toContain('Pilot locations are hidden.');
    expect(banner?.textContent).toContain('You can still see your own characters.');
    expect(banner?.textContent).toContain('Since 23 Oct 18:42 EVE');
    expect(banner?.querySelector('button')).toBeNull();
  });

  it('tells a cleared viewer that members are blind but they can see', async () => {
    await render(<BlackoutBanner blackout={ON_CLEARED} />);
    const banner = container.querySelector('[role="status"]');
    expect(banner?.getAttribute('data-blackout')).toBe('cleared');
    expect(banner?.textContent).toContain("Members can't see pilot locations. You can.");
    expect(banner?.textContent).not.toContain('your own characters');
  });

  it('omits the start time when none is known', async () => {
    await render(<BlackoutBanner blackout={{ active: true, since: null, cleared: false }} />);
    expect(container.textContent).not.toContain('Since');
  });

  it('contains no em-dashes', async () => {
    await render(<BlackoutBanner blackout={ON_RESTRICTED} />);
    expect(container.textContent).not.toContain('—');
    await render(<BlackoutBanner blackout={ON_CLEARED} />);
    expect(container.textContent).not.toContain('—');
  });
});

function pilot(characterId: number): MapPresenceEntry {
  return {
    characterId,
    characterName: `Pilot ${characterId}`,
    userId: 1,
    mainCharacterId: null,
    mainCharacterName: null,
    systemId: 30000142,
    systemName: 'Jita',
    systemSecurity: null,
    systemTrueSec: 0.9,
    shipTypeId: 670,
    shipTypeName: 'Capsule',
    shipClass: 'capsule',
    shipName: null,
    locationAt: '2026-10-23T00:00:00Z',
  };
}

describe('PilotRoster hidden state', () => {
  const common = { systemNameById: new Map(), viewerIds: new Set<number>() };

  it('explains an empty roster while pilots are hidden', async () => {
    await render(<PilotRoster {...common} presence={[]} pilotsHidden />);
    expect(container.textContent).toContain('Pilot locations are hidden during Blackout.');
    expect(container.textContent).not.toContain('No tracked pilots are online.');
  });

  it('notes the Blackout above the viewer’s own characters', async () => {
    await render(<PilotRoster {...common} presence={[pilot(11)]} pilotsHidden />);
    expect(container.textContent).toContain('Only your own characters are shown.');
    expect(container.textContent).toContain('Pilot 11');
  });

  it('shows no Blackout copy while pilots are not hidden', async () => {
    await render(<PilotRoster {...common} presence={[]} pilotsHidden={false} />);
    expect(container.textContent).toContain('No tracked pilots are online.');
    expect(container.textContent).not.toContain('Blackout');
    await render(<PilotRoster {...common} presence={[pilot(11)]} pilotsHidden={false} />);
    expect(container.textContent).not.toContain('Blackout');
  });
});

describe('ConnectionMassLog hidden state', () => {
  const connection = { id: '5', jumpMassClass: null } as unknown as MapConnectionEdge;
  const entry: ConnectionMassLogEntry = {
    id: '1',
    characterId: 11,
    characterName: 'Pilot 11',
    shipTypeId: 670,
    shipTypeName: 'Capsule',
    mass: 32_000,
    cumulativeMass: 32_000,
    jumpedAt: '2026-10-23T18:00:00.000Z',
  } as unknown as ConnectionMassLogEntry;

  it('renders the hidden marker instead of the empty state', async () => {
    fetchConnectionMassLog.mockResolvedValue({ ok: true, data: [], hidden: true });
    await render(<ConnectionMassLog mapId="7" connection={connection} />);
    expect(container.textContent).toContain('The mass log is hidden during Blackout.');
    expect(container.textContent).not.toContain('No jumps logged yet.');
  });

  it('renders the log when the server does not mark it hidden', async () => {
    fetchConnectionMassLog.mockResolvedValue({ ok: true, data: [entry] });
    await render(<ConnectionMassLog mapId="7" connection={connection} />);
    expect(container.textContent).toContain('Pilot 11');
    expect(container.textContent).not.toContain('Blackout');
  });

  it('refetches when the viewer stops being restricted', async () => {
    realtimeBlackout = ON_RESTRICTED;
    fetchConnectionMassLog.mockResolvedValue({ ok: true, data: [], hidden: true });
    await render(<ConnectionMassLog mapId="7" connection={connection} />);
    expect(container.textContent).toContain('hidden during Blackout');

    realtimeBlackout = OFF;
    fetchConnectionMassLog.mockResolvedValue({ ok: true, data: [entry] });
    await render(<ConnectionMassLog mapId="7" connection={connection} />);
    expect(fetchConnectionMassLog).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Pilot 11');
    expect(container.textContent).not.toContain('Blackout');
  });

  it('does not refetch on the first standing to arrive', async () => {
    fetchConnectionMassLog.mockResolvedValue({ ok: true, data: [entry] });
    await render(<ConnectionMassLog mapId="7" connection={connection} />);
    realtimeBlackout = OFF;
    await render(<ConnectionMassLog mapId="7" connection={connection} />);
    expect(fetchConnectionMassLog).toHaveBeenCalledTimes(1);
  });

  it('refetches when the first standing to arrive contradicts a hidden log', async () => {
    fetchConnectionMassLog.mockResolvedValue({ ok: true, data: [], hidden: true });
    await render(<ConnectionMassLog mapId="7" connection={connection} />);
    expect(container.textContent).toContain('hidden during Blackout');

    realtimeBlackout = OFF;
    fetchConnectionMassLog.mockResolvedValue({ ok: true, data: [entry] });
    await render(<ConnectionMassLog mapId="7" connection={connection} />);
    expect(fetchConnectionMassLog).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Pilot 11');
    expect(container.textContent).not.toContain('Blackout');
  });

  it('refetches when the first standing to arrive contradicts a visible log', async () => {
    fetchConnectionMassLog.mockResolvedValue({ ok: true, data: [entry] });
    await render(<ConnectionMassLog mapId="7" connection={connection} />);

    realtimeBlackout = ON_RESTRICTED;
    fetchConnectionMassLog.mockResolvedValue({ ok: true, data: [], hidden: true });
    await render(<ConnectionMassLog mapId="7" connection={connection} />);
    expect(fetchConnectionMassLog).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('hidden during Blackout');
  });
});

describe('ConnectionDetailPopover mass-log hidden state', () => {
  const connection = {
    id: '5',
    jumpMassClass: null,
    eolStage: 'none',
  } as unknown as MapConnectionEdge;
  const popover = (
    <ConnectionDetailPopover
      connection={connection}
      mapId="7"
      wormholeTypeId={null}
      wormholeCode={null}
    >
      <span>badge</span>
    </ConnectionDetailPopover>
  );

  it('shows the mass logged as hidden instead of zero', async () => {
    fetchConnectionMassLog.mockResolvedValue({ ok: true, data: [], hidden: true });
    await render(popover);
    expect(container.textContent).toContain('Mass loggedHidden during Blackout');
    expect(container.textContent).not.toContain('—');
  });

  it('shows the cumulative when the server does not mark it hidden', async () => {
    fetchConnectionMassLog.mockResolvedValue({ ok: true, data: [] });
    await render(popover);
    expect(container.textContent).toContain('Mass logged');
    expect(container.textContent).not.toContain('Blackout');
  });
});
