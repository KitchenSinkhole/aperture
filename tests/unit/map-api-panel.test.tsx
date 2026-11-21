import type React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapApiState, UserApiTokenListItem } from '@/types';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/app/(app)/actions/mapApi', () => ({
  getMapApiState: vi.fn(),
  createMapApiToken: vi.fn(),
  revokeMapApiToken: vi.fn(),
  updateMapApiSettings: vi.fn(),
}));
// Base UI primitives need portals and contexts jsdom can't provide: the stubs
// render inline, and a dialog renders its children only while open.
vi.mock('@/components/ui/dialog', async () => {
  const { createContext, createElement, useContext } = await import('react');
  const OpenChange = createContext<((open: boolean) => void) | undefined>(undefined);
  const passthrough =
    (slot: string) =>
    ({ children }: { children?: React.ReactNode }) =>
      createElement('div', { 'data-slot': slot }, children);
  return {
    Dialog: ({
      children,
      open,
      onOpenChange,
    }: {
      children?: React.ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    }) =>
      createElement(
        OpenChange.Provider,
        { value: onOpenChange },
        open ? createElement('div', { 'data-slot': 'dialog' }, children) : null,
      ),
    DialogContent: passthrough('dialog-content'),
    DialogDescription: passthrough('dialog-description'),
    DialogFooter: passthrough('dialog-footer'),
    DialogHeader: passthrough('dialog-header'),
    DialogTitle: passthrough('dialog-title'),
    DialogTrigger: () => null,
    DialogClose: function DialogClose({ children }: { children?: React.ReactNode }) {
      const onOpenChange = useContext(OpenChange);
      return createElement(
        'button',
        { type: 'button', onClick: () => onOpenChange?.(false) },
        children,
      );
    },
  };
});
vi.mock('@/components/ui/button', async () => {
  const { createElement } = await import('react');
  return {
    Button: ({
      children,
      disabled,
      onClick,
      type,
    }: {
      children?: React.ReactNode;
      disabled?: boolean;
      onClick?: () => void;
      type?: 'button' | 'submit';
    }) => createElement('button', { type: type ?? 'button', disabled, onClick }, children),
  };
});
vi.mock('@/components/ui/input', async () => {
  const { createElement } = await import('react');
  return { Input: (props: Record<string, unknown>) => createElement('input', props) };
});
vi.mock('@/components/ui/select', async () => {
  const { createElement, Fragment } = await import('react');
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    createElement(Fragment, null, children);
  return {
    Select: passthrough,
    SelectContent: () => null,
    SelectItem: () => null,
    SelectTrigger: passthrough,
    SelectValue: passthrough,
  };
});

import { createMapApiToken, getMapApiState } from '@/app/(app)/actions/mapApi';
import { MapApiPanel } from '@/components/map/manage/MapApiPanel';

const mockGetState = vi.mocked(getMapApiState);
const mockCreate = vi.mocked(createMapApiToken);

const RAW = `apu_${'A'.repeat(43)}`;

function tokenItem(overrides: Partial<UserApiTokenListItem> = {}): UserApiTokenListItem {
  return {
    id: '1',
    label: 'Chain bot',
    prefix: 'AbCdEf',
    scopes: ['map'],
    ownerName: 'Pilot One',
    own: true,
    createdAt: '2026-11-20T10:00:00.000Z',
    expiresAt: null,
    lastUsedAt: null,
    requestCount: '0',
    status: 'active',
    suspendedUntil: null,
    ...overrides,
  };
}

function viewerState(overrides: Partial<MapApiState> = {}): MapApiState {
  return {
    instanceEnabled: true,
    apiEnabled: true,
    apiScopes: ['map', 'signatures'],
    canManage: false,
    block: null,
    ownTokens: [tokenItem()],
    mapTokens: null,
    limits: { perMap: 3, perAccount: 20, liveOnAccount: 1 },
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mockGetState.mockReset();
  mockCreate.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(state: MapApiState, live = { apiEnabled: true, apiScopes: state.apiScopes }) {
  mockGetState.mockResolvedValue({ ok: true, data: state });
  await act(async () => {
    root.render(<MapApiPanel mapId="7" apiEnabled={live.apiEnabled} apiScopes={live.apiScopes} />);
  });
}

function checkbox(label: string): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>(`input[type="checkbox"][aria-label="${label}"]`);
}

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(text),
  );
  if (!found) throw new Error(`no button "${text}"`);
  return found;
}

function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('MapApiPanel', () => {
  it('shows a viewer their tokens and only the scopes the map exposes, with no manager block', async () => {
    await render(viewerState());
    expect(mockGetState).toHaveBeenCalledWith('7');
    expect(checkbox('Enable the API on this map')).toBeNull();
    expect(container.textContent).not.toContain('Every token on this map');
    expect(container.textContent).toContain('Chain bot');
    expect(checkbox('Token reads Map')).not.toBeNull();
    expect(checkbox('Token reads Signatures')).not.toBeNull();
    expect(checkbox('Token reads Pilots')).toBeNull();
    expect(checkbox('Token reads Notes')).toBeNull();
    expect(button('Create token').disabled).toBe(false);
  });

  it('gives a manager the switch, the scopes and every token on the map with its status', async () => {
    await render(
      viewerState({
        canManage: true,
        mapTokens: [
          tokenItem(),
          tokenItem({
            id: '2',
            label: 'Their bot',
            own: false,
            ownerName: 'Pilot Two',
            status: 'suspended',
            suspendedUntil: '2026-11-21T12:00:00.000Z',
          }),
          tokenItem({
            id: '3',
            label: 'Old bot',
            own: false,
            ownerName: null,
            status: 'lost_access',
          }),
        ],
      }),
    );
    expect(checkbox('Enable the API on this map')!.checked).toBe(true);
    expect(checkbox('Expose Map')!.checked).toBe(true);
    expect(checkbox('Expose Pilots')!.checked).toBe(false);
    expect(container.textContent).toContain('Every token on this map');
    expect(container.textContent).toContain('Pilot Two');
    expect(container.textContent).toContain('Suspended until');
    expect(container.textContent).toContain('Owner lost access');
  });

  it('shows a blocked account the banner and disables the create form', async () => {
    await render(viewerState({ block: { reason: 'Kept hammering after 429s.', until: null } }));
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('until an admin lifts it');
    expect(alert?.textContent).toContain('Kept hammering after 429s.');
    expect(button('Create token').disabled).toBe(true);
  });

  it('reveals a minted token once, and drops it when the dialog closes', async () => {
    await render(viewerState());
    mockCreate.mockResolvedValue({ ok: true, data: { token: RAW, tokenId: '9' } });

    await act(async () => {
      typeInto(container.querySelector<HTMLInputElement>('#api-token-label')!, 'Overlay');
    });
    await act(async () => {
      checkbox('Token reads Signatures')!.click();
    });
    await act(async () => {
      button('Create token').click();
    });

    expect(mockCreate).toHaveBeenCalledWith({
      mapId: '7',
      label: 'Overlay',
      scopes: ['signatures'],
      expiresInDays: 90,
    });
    const reveal = container.querySelector<HTMLInputElement>('input[aria-label="New API token"]');
    expect(reveal?.value).toBe(RAW);
    expect(container.textContent).toContain('It will not be shown again');
    expect(mockGetState).toHaveBeenCalledTimes(2);

    await act(async () => {
      button('Done').click();
    });
    expect(container.querySelector('input[aria-label="New API token"]')).toBeNull();
    expect(container.innerHTML).not.toContain(RAW);
  });
});
