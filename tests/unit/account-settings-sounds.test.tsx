import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Must be called before the imports that depend on them — Vitest hoists vi.mock calls.
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/app/(app)/actions/account', () => ({
  setConnectionTravelAnimationAction: vi.fn(async () => ({ ok: true })),
  setMainCharacterAction: vi.fn(async () => ({ ok: true })),
  setSignatureIndicatorPrefsAction: vi.fn(async () => ({ ok: true })),
  setSoundPrefsAction: vi.fn(async () => ({ ok: true })),
  deleteAccountAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/sounds/engine', () => ({
  getSoundEngine: () => ({ setPrefs: vi.fn(), preview: vi.fn() }),
}));
// Stub the Base UI-backed primitives — they need portals/contexts jsdom can't provide.
vi.mock('@/components/ui/dialog', async () => {
  const { createElement } = await import('react');
  const passthrough =
    (slot: string) =>
    ({ children, className }: { children?: React.ReactNode; className?: string }) =>
      createElement('div', { 'data-slot': slot, className }, children);
  return {
    Dialog: ({ children, open }: { children?: React.ReactNode; open?: boolean }) =>
      open ? createElement('div', { 'data-slot': 'dialog' }, children) : null,
    DialogContent: passthrough('dialog-content'),
    DialogDescription: passthrough('dialog-description'),
    DialogHeader: passthrough('dialog-header'),
    DialogTitle: passthrough('dialog-title'),
  };
});
vi.mock('@/components/ui/avatar', async () => {
  const { createElement } = await import('react');
  const stub = ({ children }: { children?: React.ReactNode }) =>
    createElement('span', null, children);
  return { Avatar: stub, AvatarFallback: stub, AvatarImage: () => null };
});
vi.mock('@/components/ui/button', async () => {
  const { createElement } = await import('react');
  return {
    Button: ({
      children,
      disabled,
      onClick,
    }: {
      children?: React.ReactNode;
      disabled?: boolean;
      onClick?: () => void;
    }) => createElement('button', { type: 'button', disabled, onClick }, children),
  };
});
vi.mock('@/components/account/SoundPicker', () => ({ SoundPicker: () => null }));
vi.mock('@/components/account/DeleteAccountDialog', () => ({ DeleteAccountDialog: () => null }));

import { setSoundPrefsAction } from '@/app/(app)/actions/account';
import { AccountSettingsDialog } from '@/components/account/AccountSettingsDialog';
import { DEFAULT_SOUND_PREFS } from '@/lib/sounds/prefs';
import type { SoundPrefs } from '@/types';

const mockSetSoundPrefs = vi.mocked(setSoundPrefsAction);

const soundPrefs: SoundPrefs = {
  ...DEFAULT_SOUND_PREFS,
  enabled: true,
  volume: 0.7,
  events: {
    ...DEFAULT_SOUND_PREFS.events,
    pilotArrived: { ...DEFAULT_SOUND_PREFS.events.pilotArrived, enabled: false },
  },
};

let container: HTMLDivElement;
let root: Root;

async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <AccountSettingsDialog
        open
        onOpenChange={() => {}}
        characters={[{ id: '1', name: 'Pilot', status: 'active', authzLevel: 'member' }]}
        mainCharacterId="1"
        activeCharacter={{ id: '1', name: 'Pilot' }}
        travelAnimation={false}
        signatureIndicators={{
          globalThresholdMinutes: 180,
          userThresholdMinutes: null,
          showStale: true,
          showUnscanned: true,
        }}
        soundPrefs={soundPrefs}
      />,
    );
  });
}

function volumeSlider(): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>('input[aria-label="Sound volume"]');
  if (!el) throw new Error('volume slider not rendered');
  return el;
}

function eventCheckbox(label: string): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!el) throw new Error(`checkbox ${label} not rendered`);
  return el;
}

/** Drive the range input the way a browser does for a keyboard nudge. */
function setSliderValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mockSetSoundPrefs.mockReset();
  mockSetSoundPrefs.mockResolvedValue({ ok: true });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('AccountSettingsDialog — sound volume', () => {
  it('commits a keyboard-only volume change without waiting for blur', async () => {
    await render();
    const slider = volumeSlider();

    await act(async () => {
      setSliderValue(slider, '40');
      slider.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'ArrowLeft' }));
    });

    expect(mockSetSoundPrefs).toHaveBeenCalledTimes(1);
    expect(mockSetSoundPrefs).toHaveBeenCalledWith(expect.objectContaining({ volume: 0.4 }));
  });

  it('does not re-commit on key release when the volume is unchanged', async () => {
    await render();
    await act(async () => {
      volumeSlider().dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Tab' }));
    });
    expect(mockSetSoundPrefs).not.toHaveBeenCalled();
  });

  it('locks the slider while another control is committing, so commits cannot overlap', async () => {
    await render();
    // A commit that never settles keeps the transition pending.
    mockSetSoundPrefs.mockReturnValue(new Promise(() => {}));

    await act(async () => {
      eventCheckbox('Pilot arrives').click();
    });

    expect(mockSetSoundPrefs).toHaveBeenCalledTimes(1);
    expect(volumeSlider().disabled).toBe(true);
  });
});
