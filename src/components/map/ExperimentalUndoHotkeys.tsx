'use client';

import { useEffect } from 'react';
import { isExperimentalUiActive, readExperimentalUiFromHtml } from '@/lib/experimentalUi';
import {
  experimentalRedoApply,
  experimentalUndoApply,
  experimentalUndoPanelFromFocus,
} from '@/lib/experimentalPanelUndo';

/** Ctrl+Z / Ctrl+Shift+Z on the focused experimental panel stack. */
export function ExperimentalUndoHotkeys() {
  useEffect(() => {
    if (!isExperimentalUiActive(readExperimentalUiFromHtml())) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      const panel = experimentalUndoPanelFromFocus();
      if (!panel) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      if (e.shiftKey) void experimentalRedoApply(panel);
      else void experimentalUndoApply(panel);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return null;
}
