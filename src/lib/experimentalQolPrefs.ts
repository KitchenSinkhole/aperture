'use client';

import { readExperimentalUiFromHtml, isExperimentalUiActive } from '@/lib/experimentalUi';

const KEEP_SELECTION_KEY = 'aperture:experimental:keep-map-selection';
const POINTER_CURSOR_KEY = 'aperture:experimental:pointer-cursor';
const PASTE_PREVIEW_KEY = 'aperture:experimental:paste-preview';
const AUTO_MASS_KEY = 'aperture:experimental:auto-mass-from-log';

export const EXPERIMENTAL_POINTER_CURSOR_DEFAULT = true;

function experimentalOnly<T>(read: () => T, fallback: T): T {
  if (!isExperimentalUiActive(readExperimentalUiFromHtml())) return fallback;
  return read();
}

export function readKeepMapSelection(): boolean {
  return experimentalOnly(() => {
    try {
      return localStorage.getItem(KEEP_SELECTION_KEY) === '1';
    } catch {
      return false;
    }
  }, false);
}

export function writeKeepMapSelection(on: boolean): void {
  try {
    localStorage.setItem(KEEP_SELECTION_KEY, on ? '1' : '0');
  } catch {
    return;
  }
  window.dispatchEvent(new CustomEvent('aperture:experimental-qol-prefs'));
}

export function readExperimentalPointerCursor(): boolean {
  return experimentalOnly(() => {
    try {
      const raw = localStorage.getItem(POINTER_CURSOR_KEY);
      if (raw === null) return EXPERIMENTAL_POINTER_CURSOR_DEFAULT;
      return raw === '1';
    } catch {
      return EXPERIMENTAL_POINTER_CURSOR_DEFAULT;
    }
  }, false);
}

export function writeExperimentalPointerCursor(on: boolean): void {
  try {
    localStorage.setItem(POINTER_CURSOR_KEY, on ? '1' : '0');
  } catch {
    return;
  }
  applyPointerCursorAttribute(on);
  window.dispatchEvent(new CustomEvent('aperture:experimental-qol-prefs'));
}

const PORTAL_MENU_CURSOR_SELECTOR =
  '[data-slot="menu-item"],[data-slot="menu-submenu-trigger"],[data-slot="menu-checkbox-item"],[data-slot="menu-radio-item"],[data-slot="select-item"],[role="menuitem"]';

/** Drop inline cursor on open portalled menus so the html attribute rule applies again after toggling. */
function clearPortalledMenuInlineCursor(): void {
  if (typeof document === 'undefined') return;
  document.querySelectorAll<HTMLElement>(PORTAL_MENU_CURSOR_SELECTOR).forEach((el) => {
    el.style.removeProperty('cursor');
  });
}

export function applyPointerCursorAttribute(on: boolean): void {
  if (!isExperimentalUiActive(readExperimentalUiFromHtml())) {
    document.documentElement.removeAttribute('data-pointer-cursor');
    return;
  }
  document.documentElement.setAttribute('data-pointer-cursor', on ? 'on' : 'off');
  if (on) clearPortalledMenuInlineCursor();
}

export function readPastePreviewOnCtrlV(): boolean {
  return experimentalOnly(() => {
    try {
      return localStorage.getItem(PASTE_PREVIEW_KEY) === '1';
    } catch {
      return false;
    }
  }, false);
}

export function writePastePreviewOnCtrlV(on: boolean): void {
  try {
    localStorage.setItem(PASTE_PREVIEW_KEY, on ? '1' : '0');
  } catch {
    return;
  }
  window.dispatchEvent(new CustomEvent('aperture:experimental-qol-prefs'));
}

export function readExperimentalAutoMassFromLog(): boolean {
  return experimentalOnly(() => readFlag(AUTO_MASS_KEY), false);
}

export function writeExperimentalAutoMassFromLog(on: boolean): void {
  try {
    localStorage.setItem(AUTO_MASS_KEY, on ? '1' : '0');
  } catch {
    return;
  }
  window.dispatchEvent(new CustomEvent('aperture:experimental-qol-prefs'));
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
