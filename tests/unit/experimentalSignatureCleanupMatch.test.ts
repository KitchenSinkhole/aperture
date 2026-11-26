import { describe, expect, it } from 'vitest';
import { DEFAULT_SIGNATURE_CLEANUP_SETTINGS } from '@/components/dialogs/SignatureCleanupDialog';
import { matchSignaturesForExperimentalCleanup } from '@/lib/map/experimentalSignatureCleanupMatch';
import type { MapSignature, MapSystemNode, SignatureIndicatorPrefs } from '@/types';

const prefs: SignatureIndicatorPrefs = {
  thresholdMinutes: 48 * 60,
  showStale: true,
  showUnscanned: true,
};

describe('matchSignaturesForExperimentalCleanup', () => {
  it('returns empty when scope is system and nothing is selected', () => {
    const matched = matchSignaturesForExperimentalCleanup({
      settings: { ...DEFAULT_SIGNATURE_CLEANUP_SETTINGS, scope: 'system' },
      selectedSystem: null,
      systems: [],
      signatures: [{ id: 's1' } as MapSignature],
      connections: [],
      indicatorPrefs: prefs,
      isWormholeSystem: () => false,
    });
    expect(matched).toEqual([]);
  });

  it('filters by olderThanHours in chain scope', () => {
    const old = new Date(Date.now() - 72 * 3_600_000).toISOString();
    const fresh = new Date().toISOString();
    const systems = [{ id: 'ms1', systemId: '30000001' } as unknown as MapSystemNode];
    const signatures = [
      { id: 'a', mapSystemId: 'ms1', updatedAt: old, groupKey: 'combat' },
      { id: 'b', mapSystemId: 'ms1', updatedAt: fresh, groupKey: 'combat' },
    ] as MapSignature[];
    const matched = matchSignaturesForExperimentalCleanup({
      settings: {
        ...DEFAULT_SIGNATURE_CLEANUP_SETTINGS,
        scope: 'chain',
        olderThanHours: 48,
        staleByIndicator: false,
      },
      selectedSystem: null,
      systems,
      signatures,
      connections: [],
      indicatorPrefs: prefs,
      isWormholeSystem: () => false,
    });
    expect(matched.map((s) => s.id)).toEqual(['a']);
  });
});