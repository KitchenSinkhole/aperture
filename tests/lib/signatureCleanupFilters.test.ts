// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { filterSignaturesForCleanup } from '@/lib/map/signatureCleanupFilters';
import type { MapConnectionEdge, MapSignature } from '@/types';

const sig = (id: string, patch: Partial<MapSignature> = {}): MapSignature => ({
  id,
  mapSystemId: '1',
  mapConnectionId: null,
  sigId: id,
  groupKey: 'combat',
  classKind: 'signature',
  activityOverride: null,
  typeId: null,
  eolStage: 'none',
  wormholeCode: null,
  name: 'Site',
  description: null,
  expiresAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date(Date.now() - 72 * 3_600_000).toISOString(),
  ...patch,
});

describe('filterSignaturesForCleanup', () => {
  it('filters by age and group', () => {
    const rows = filterSignaturesForCleanup(
      [sig('A'), sig('B', { groupKey: 'gas', updatedAt: new Date().toISOString() })],
      [],
      { olderThanHours: 24, groups: ['combat'] },
    );
    expect(rows.map((s) => s.sigId)).toEqual(['A']);
  });

  it('filters WH sigs whose link is expired', () => {
    const conn: MapConnectionEdge = {
      id: '9',
      source: '1',
      target: '2',
      scope: 'wh',
      massStatus: 'fresh',
      jumpMassClass: null,
      eolStage: 'expired',
      preserveMass: false,
      isRolling: false,
      isStatic: false,
      sourceBubbled: false,
      targetBubbled: false,
      eolAt: null,
      createdAt: new Date().toISOString(),
    };
    const rows = filterSignaturesForCleanup(
      [sig('WH', { groupKey: 'wormhole', mapConnectionId: '9' })],
      [conn],
      { whLinkExpiredConnectionIds: new Set(['9']) },
    );
    expect(rows).toHaveLength(1);
  });
});
