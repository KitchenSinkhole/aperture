import type React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountApiState, UserApiTokenListItem } from '@/types';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/app/(app)/actions/mapApi', () => ({
  getAccountApiTokens: vi.fn(),
  revokeMapApiToken: vi.fn(),
}));
// Base UI primitives need portals and contexts jsdom can't provide: the stubs
// render inline, a dialog's content renders only while it is open, and a
// trigger is a plain button that opens it.
vi.mock('@/components/ui/dialog', async () => {
  const { createContext, createElement, useContext } = await import('react');
  const State = createContext<{ open: boolean; onOpenChange?: (open: boolean) => void }>({
    open: false,
  });
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
    }) => createElement(State.Provider, { value: { open: !!open, onOpenChange } }, children),
    DialogContent: function DialogContent({ children }: { children?: React.ReactNode }) {
      const { open } = useContext(State);
      return open ? createElement('div', { 'data-slot': 'dialog-content' }, children) : null;
    },
    DialogDescription: passthrough('dialog-description'),
    DialogFooter: passthrough('dialog-footer'),
    DialogHeader: passthrough('dialog-header'),
    DialogTitle: passthrough('dialog-title'),
    DialogTrigger: function DialogTrigger() {
      const { onOpenChange } = useContext(State);
      return createElement(
        'button',
        { type: 'button', onClick: () => onOpenChange?.(true) },
        'Open',
      );
    },
    DialogClose: function DialogClose({ children }: { children?: React.ReactNode }) {
      const { onOpenChange } = useContext(State);
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

import { getAccountApiTokens, revokeMapApiToken } from '@/app/(app)/actions/mapApi';
import { AccountApiTokens } from '@/components/account/AccountApiTokens';

const mockGetTokens = vi.mocked(getAccountApiTokens);
const mockRevoke = vi.mocked(revokeMapApiToken);

function tokenItem(overrides: Partial<UserApiTokenListItem> = {}): UserApiTokenListItem {
  return {
    id: '1',
    mapId: '7',
    mapName: 'Home chain',
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

function accountState(overrides: Partial<AccountApiState> = {}): AccountApiState {
  return { instanceEnabled: true, block: null, tokens: [tokenItem()], ...overrides };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mockGetTokens.mockReset();
  mockRevoke.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(state: AccountApiState) {
  mockGetTokens.mockResolvedValue({ ok: true, data: state });
  await act(async () => {
    root.render(<AccountApiTokens />);
  });
}

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(text),
  );
  if (!found) throw new Error(`no button "${text}"`);
  return found;
}

describe('AccountApiTokens', () => {
  it('lists every token with its map and computed status', async () => {
    await render(
      accountState({
        tokens: [
          tokenItem(),
          tokenItem({
            id: '2',
            label: 'Old map bot',
            mapName: 'Lost chain',
            status: 'lost_access',
          }),
          tokenItem({ id: '3', label: 'Quiet bot', mapName: 'Off chain', status: 'api_disabled' }),
          tokenItem({ id: '4', label: 'Gone bot', mapName: 'Gone chain', status: 'map_deleted' }),
        ],
      }),
    );
    const text = container.textContent ?? '';
    for (const s of ['Home chain', 'Lost chain', 'Off chain', 'Gone chain']) {
      expect(text).toContain(s);
    }
    expect(text).toContain('Owner lost access');
    expect(text).toContain('API off on this map');
    expect(text).toContain('Map deleted');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows an empty list as no tokens', async () => {
    await render(accountState({ tokens: [] }));
    expect(container.textContent).toContain('No tokens.');
  });

  it('shows a timed block with its reason and end', async () => {
    const until = '2026-11-28T10:00:00.000Z';
    await render(accountState({ block: { reason: 'Strike three.', until } }));
    const alert = container.querySelector('[role="alert"]');
    const expected = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(until));
    expect(alert?.textContent).toContain(`until ${expected}`);
    expect(alert?.textContent).toContain('Strike three.');
    expect(alert?.textContent).not.toContain('until an admin lifts it');
  });

  it('shows an indefinite block as lasting until an admin lifts it', async () => {
    await render(accountState({ block: { reason: 'Repeat offence.', until: null } }));
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('until an admin lifts it');
    expect(alert?.textContent).toContain('Repeat offence.');
  });

  it('revokes a token and reloads the list', async () => {
    await render(accountState({ tokens: [tokenItem({ id: '2', status: 'lost_access' })] }));
    mockRevoke.mockResolvedValue({ ok: true });
    await act(async () => {
      button('Open').click();
    });
    await act(async () => {
      button('Revoke').click();
    });
    expect(mockRevoke).toHaveBeenCalledWith('2');
    expect(mockGetTokens).toHaveBeenCalledTimes(2);
  });
});
