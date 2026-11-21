import { describe, expect, it } from 'vitest';
import { isBlackedOut, isPilotHidden } from '@/lib/auth/blackout';
import type { BlackoutViewer } from '@/types';

const VIEWER_USER = 7;
const OTHER_USER = 8;

function viewer(active: boolean, cleared: boolean): BlackoutViewer {
  return { active, cleared, userId: VIEWER_USER };
}

describe('isBlackedOut', () => {
  it('restricts only an active, non-cleared viewer', () => {
    expect(isBlackedOut(viewer(true, false))).toBe(true);
    expect(isBlackedOut(viewer(true, true))).toBe(false);
    expect(isBlackedOut(viewer(false, false))).toBe(false);
    expect(isBlackedOut(viewer(false, true))).toBe(false);
  });
});

describe('isPilotHidden', () => {
  it("hides another account's pilot from a non-cleared viewer while on", () => {
    expect(isPilotHidden(viewer(true, false), OTHER_USER)).toBe(true);
  });

  it("never hides the viewer's own account", () => {
    expect(isPilotHidden(viewer(true, false), VIEWER_USER)).toBe(false);
  });

  it('hides nothing from a cleared viewer', () => {
    expect(isPilotHidden(viewer(true, true), OTHER_USER)).toBe(false);
  });

  it('hides nothing while off', () => {
    expect(isPilotHidden(viewer(false, false), OTHER_USER)).toBe(false);
  });
});
