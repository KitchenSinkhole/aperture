import { beforeEach, describe, expect, it } from 'vitest';
import {
  isManualConnectionMassLocked,
  lockManualConnectionMass,
  resetManualConnectionMassLocks,
} from '@/lib/experimentalManualMass';

describe('experimentalManualMass', () => {
  beforeEach(() => resetManualConnectionMassLocks());

  it('locks a connection after manual mass', () => {
    expect(isManualConnectionMassLocked('c1')).toBe(false);
    lockManualConnectionMass('c1');
    expect(isManualConnectionMassLocked('c1')).toBe(true);
  });
});