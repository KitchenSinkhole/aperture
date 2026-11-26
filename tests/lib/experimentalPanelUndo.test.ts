// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  experimentalRedoApply,
  experimentalUndoApply,
  experimentalUndoCan,
  experimentalUndoPush,
  experimentalUndoResetAll,
} from '@/lib/experimentalPanelUndo';

describe('experimentalPanelUndo', () => {
  afterEach(() => {
    experimentalUndoResetAll();
  });

  it('pushes and undoes within depth cap', async () => {
    let n = 0;
    experimentalUndoPush('signatures', {
      label: 'add sig',
      undo: () => {
        n -= 1;
      },
      redo: () => {
        n += 1;
      },
      serialized: { undo: { test: 1 }, redo: { test: 2 } },
    });
    expect(experimentalUndoCan('signatures').undo).toBe(true);
    await experimentalUndoApply('signatures');
    expect(n).toBe(-1);
    expect(experimentalUndoCan('signatures').redo).toBe(true);
    await experimentalRedoApply('signatures');
    expect(n).toBe(0);
  });
});
