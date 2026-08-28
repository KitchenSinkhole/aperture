'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  DEFAULT_PIP_WINDOW_SIZE,
  readPipWindowSize,
  writePipWindowSize,
} from '@/lib/pipWindowPrefs';

// Stable no-op subscription — capability never changes within a session.
const NEVER_CHANGES = () => () => {};

// How long Chromium's own post-open resizes keep arriving.
const POST_OPEN_SETTLE_MS = 1500;

// Minimal typings for the Document Picture-in-Picture API (Chromium 116+). Not
// yet in the DOM lib, so we declare just the surface we use.
interface DocumentPictureInPictureOptions {
  width?: number;
  height?: number;
}

interface DocumentPictureInPictureApi {
  requestWindow(options?: DocumentPictureInPictureOptions): Promise<Window>;
  readonly window: Window | null;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPictureApi;
  }
}

export interface DocumentPipController {
  /** The live PiP window, or null when closed. Portal target for overlay content. */
  pipWindow: Window | null;
  isOpen: boolean;
  /** Chromium-only; false on the server and in non-supporting browsers. */
  isSupported: boolean;
  open: () => Promise<void>;
  close: () => void;
}

// Copy every stylesheet from the opener document into the PiP document so the
// portalled subtree renders with the same Tailwind utilities. Dev injects styles
// as <style>, prod as <link rel="stylesheet"> — clone both.
function cloneStyles(target: Window): void {
  const nodes = document.head.querySelectorAll('style, link[rel="stylesheet"]');
  for (const node of Array.from(nodes)) {
    target.document.head.appendChild(node.cloneNode(true));
  }
}

/**
 * Owns one Document Picture-in-Picture window's lifecycle. `open()` requests the
 * OS-level always-on-top window (must be called from a user gesture), clones the
 * opener's stylesheets and dark-mode class so portalled content is themed, and
 * fills the body with the app's dark surface. The window is closed on unmount,
 * on explicit `close()`, and its own chrome ✕ clears state via `pagehide`.
 */
export function useDocumentPip(): DocumentPipController {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  // `useSyncExternalStore` resolves false on the server and true (if supported)
  // on the client without a hydration mismatch on the button's disabled state.
  const isSupported = useSyncExternalStore(
    NEVER_CHANGES,
    () => 'documentPictureInPicture' in window,
    () => false,
  );

  const open = useCallback(async () => {
    if (typeof window === 'undefined' || !window.documentPictureInPicture) return;
    // Passing dimensions forces initial placement and discards the size *and*
    // position Chromium remembers from the last close, so they are passed only
    // on the first open of a browser profile, when there is nothing to restore.
    const hadStoredSize = readPipWindowSize() !== null;
    const pip = await window.documentPictureInPicture.requestWindow(
      hadStoredSize ? undefined : DEFAULT_PIP_WINDOW_SIZE,
    );
    cloneStyles(pip);
    // Mirror the .dark custom-variant class so themed tokens resolve identically.
    pip.document.documentElement.className = document.documentElement.className;
    // Fill the whole window with the app surface so transparent gaps don't flash white.
    pip.document.body.className = 'bg-background text-foreground min-h-screen';

    // Chromium refuses to *open* a PiP window narrower than roughly 300px, so a
    // narrower remembered width arrives clamped. `resizeTo` reaches past that
    // floor, but needs a user activation and `requestWindow` consumed the one
    // from the opening click — the first interaction inside the window carries a
    // fresh one. The size is re-read at that moment, so a resize the user made
    // in between wins.
    const restoreStoredSize = () => {
      detachRestore();
      const target = readPipWindowSize();
      if (!target || (target.width === pip.outerWidth && target.height === pip.outerHeight)) return;
      try {
        pip.resizeTo(target.width, target.height);
      } catch {
        // NotAllowedError — the interaction carried no activation after all.
      }
    };
    const detachRestore = () => {
      pip.document.removeEventListener('pointerdown', restoreStoredSize);
      pip.document.removeEventListener('keydown', restoreStoredSize);
    };
    if (hadStoredSize) {
      pip.document.addEventListener('pointerdown', restoreStoredSize);
      pip.document.addEventListener('keydown', restoreStoredSize);
    }

    // Chromium fires several resizes of its own while the window settles after
    // opening, at the size it chose rather than the one the pilot picked.
    // Persisting those would overwrite the remembered size with a clamped one.
    const openedAt = Date.now();
    const isSettling = () => Date.now() - openedAt < POST_OPEN_SETTLE_MS;

    // Persist the live size on resize (debounced) so the next open() restores it.
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (isSettling()) return;
        writePipWindowSize({ width: pip.outerWidth, height: pip.outerHeight });
      }, 300);
    };
    pip.addEventListener('resize', onResize);

    // A closed window reports 0×0, so the pending debounce is dropped and the
    // final size flushed here, while the window can still be measured.
    pip.addEventListener(
      'pagehide',
      () => {
        clearTimeout(resizeTimer);
        pip.removeEventListener('resize', onResize);
        detachRestore();
        if (!isSettling()) writePipWindowSize({ width: pip.outerWidth, height: pip.outerHeight });
        setPipWindow(null);
      },
      { once: true },
    );

    setPipWindow(pip);
  }, []);

  const close = useCallback(() => {
    setPipWindow((w) => {
      w?.close();
      return null;
    });
  }, []);

  // Close the PiP if the opener component unmounts (Document PiP keeps the window
  // alive otherwise, orphaning a now-empty portal target).
  useEffect(() => {
    return () => {
      pipWindow?.close();
    };
  }, [pipWindow]);

  return { pipWindow, isOpen: pipWindow !== null, isSupported, open, close };
}
