import { describe, expect, it, beforeEach } from 'vitest';

const STORAGE = {
  keep: 'aperture:experimental:keep-map-selection',
  pointer: 'aperture:experimental:pointer-cursor',
  paste: 'aperture:experimental:paste-preview',
};

describe('experimentalQolPrefs', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-ui', 'experimental');
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.clear();
  });

  it('defaults pointer cursor on when experimental', async () => {
    const { readExperimentalPointerCursor } = await import('@/lib/experimentalQolPrefs');
    expect(readExperimentalPointerCursor()).toBe(true);
  });

  it('persists keep selection', async () => {
    const { readKeepMapSelection, writeKeepMapSelection } = await import('@/lib/experimentalQolPrefs');
    expect(readKeepMapSelection()).toBe(false);
    writeKeepMapSelection(true);
    expect(readKeepMapSelection()).toBe(true);
    expect(localStorage.getItem(STORAGE.keep)).toBe('1');
  });

  it('ignores prefs when experimental off', async () => {
    localStorage.setItem(STORAGE.keep, '1');
    document.documentElement.removeAttribute('data-ui');
    const { readKeepMapSelection } = await import('@/lib/experimentalQolPrefs');
    expect(readKeepMapSelection()).toBe(false);
  });

  it('re-applies pointer cursor on html after off then on', async () => {
    const { writeExperimentalPointerCursor, applyPointerCursorAttribute } = await import(
      '@/lib/experimentalQolPrefs'
    );
    writeExperimentalPointerCursor(false);
    expect(document.documentElement.getAttribute('data-pointer-cursor')).toBe('off');
    applyPointerCursorAttribute(true);
    expect(document.documentElement.getAttribute('data-pointer-cursor')).toBe('on');
    const item = document.createElement('div');
    item.setAttribute('data-slot', 'menu-item');
    item.style.cursor = 'default';
    document.body.appendChild(item);
    writeExperimentalPointerCursor(true);
    expect(item.style.cursor).toBe('');
    item.remove();
  });
});
