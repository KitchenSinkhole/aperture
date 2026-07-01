import { beforeEach, describe, expect, it, vi } from 'vitest';

// Sonner runs in a browser env; stub it so the helper stays testable.
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/map/client', () => ({ pasteSignaturesOnServer: vi.fn() }));

import { toast } from 'sonner';
import { pasteSignaturesOnServer } from '@/lib/map/client';
import { applySignaturePaste, FAST_PASTE_OPTIONS } from '@/lib/map/applySignaturePaste';
import type { BulkPasteResult, MapEventPayload, ParsedSigRow } from '@/types';

const ROWS: ParsedSigRow[] = [
  { sigId: 'ABC-123', name: null, groupName: 'Wormhole', signal: '100.0%', classKind: 'signature' },
];

function ok(summary: BulkPasteResult['summary']): { ok: true; data: BulkPasteResult; eventId: number } {
  const payloads = [{ kind: 'signature.create', eventId: 7 }] as unknown as MapEventPayload[];
  return { ok: true, data: { summary, payloads }, eventId: 0 };
}

beforeEach(() => vi.clearAllMocks());

describe('FAST_PASTE_OPTIONS', () => {
  it('is non-destructive (add + update only, never remove)', () => {
    expect(FAST_PASTE_OPTIONS).toEqual({
      addMissing: true,
      updateExisting: true,
      removeMissing: false,
      removeOrphanedConnections: false,
    });
  });
});

describe('applySignaturePaste', () => {
  it('defaults to FAST_PASTE_OPTIONS, folds payloads, and toasts a summary', async () => {
    vi.mocked(pasteSignaturesOnServer).mockResolvedValue(
      ok({ added: 2, updated: 1, removed: 0, connectionsRemoved: 0 }),
    );
    const onResult = vi.fn();

    const result = await applySignaturePaste({ mapId: '5', mapSystemId: '9', rows: ROWS, onResult });

    expect(result).toBe(true);
    expect(pasteSignaturesOnServer).toHaveBeenCalledWith({
      mapId: '5',
      body: { mapSystemId: '9', rows: ROWS, options: FAST_PASTE_OPTIONS },
    });
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('Paste applied: 2 added, 1 updated, 0 removed.');
  });

  it('appends connectionsRemoved only when > 0', async () => {
    vi.mocked(pasteSignaturesOnServer).mockResolvedValue(
      ok({ added: 0, updated: 0, removed: 1, connectionsRemoved: 1 }),
    );
    await applySignaturePaste({ mapId: '5', mapSystemId: '9', rows: ROWS, onResult: vi.fn() });
    expect(toast.success).toHaveBeenCalledWith(
      'Paste applied: 0 added, 0 updated, 1 removed, 1 connections removed.',
    );
  });

  it('forwards caller-supplied options (the dialog path)', async () => {
    vi.mocked(pasteSignaturesOnServer).mockResolvedValue(
      ok({ added: 0, updated: 0, removed: 0, connectionsRemoved: 0 }),
    );
    const options = { addMissing: true, updateExisting: true, removeMissing: true, removeOrphanedConnections: true };
    await applySignaturePaste({ mapId: '5', mapSystemId: '9', rows: ROWS, options, onResult: vi.fn() });
    expect(pasteSignaturesOnServer).toHaveBeenCalledWith({
      mapId: '5',
      body: { mapSystemId: '9', rows: ROWS, options },
    });
  });

  it('returns false and does not fold payloads or toast on error', async () => {
    vi.mocked(pasteSignaturesOnServer).mockResolvedValue({ ok: false, error: 'nope' });
    const onResult = vi.fn();
    const result = await applySignaturePaste({ mapId: '5', mapSystemId: '9', rows: ROWS, onResult });
    expect(result).toBe(false);
    expect(onResult).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
