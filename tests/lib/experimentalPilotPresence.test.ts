import { describe, expect, it } from 'vitest';
import {
  pilotBadgeToneClasses,
  pilotCountStandingTone,
  pilotNameToneClass,
} from '@/lib/experimentalPilotPresence';

describe('experimentalPilotPresence', () => {
  it('treats tracked presence as friendly', () => {
    expect(pilotCountStandingTone(3)).toBe('friendly');
    expect(pilotBadgeToneClasses('friendly')).toContain('sky');
    expect(pilotNameToneClass('friendly')).toContain('sky');
  });
});
