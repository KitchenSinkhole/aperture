// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/session', () => ({
  requireSession: vi.fn(async () => ({ characterId: '1', userId: 1 })),
}));
vi.mock('@/lib/auth/rights', () => ({
  canViewMap: vi.fn(async () => true),
}));

const { addMapRouteFavouriteAction, removeMapRouteFavouriteAction } = await import(
  '@/app/(app)/actions/mapRouteFavourites'
);
const { clearMapActiveRouteAction } = await import('@/app/(app)/actions/mapActiveRoute');

describe('map route action id validation', () => {
  it('rejects non-numeric map id on add favourite', async () => {
    const result = await addMapRouteFavouriteAction({
      mapId: 'map-1',
      systemId: 30000142,
    });
    expect(result).toEqual({ ok: false, error: 'Invalid favourite.' });
  });

  it('rejects non-numeric ids on remove favourite', async () => {
    const result = await removeMapRouteFavouriteAction({
      mapId: '1',
      favouriteId: 'fav-x',
    });
    expect(result).toEqual({ ok: false, error: 'Invalid favourite.' });
  });

  it('rejects non-numeric map id on clear active route', async () => {
    const result = await clearMapActiveRouteAction({ mapId: 'nope' });
    expect(result).toEqual({ ok: false, error: 'Invalid active route.' });
  });
});