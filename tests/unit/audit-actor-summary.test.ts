import { describe, expect, it, vi } from 'vitest';

// The grouped `(kind, count)` rows the mocked query resolves to.
const rows = vi.hoisted(() => ({ value: [] as Array<{ kind: string; count: number }> }));

vi.mock('@/db/client', () => {
  const builder: Record<string, unknown> = {};
  builder.from = () => builder;
  builder.leftJoin = () => builder;
  builder.where = () => builder;
  builder.groupBy = () => builder;
  builder.then = (resolve: (r: unknown[]) => unknown) => resolve(rows.value);
  return { db: { select: () => builder } };
});

import { auditActorSummary } from '@/lib/map/audit';

describe('auditActorSummary', () => {
  it('files share and user API kinds under access, and counts api.disabled / api.token_revoked as destructive', async () => {
    rows.value = [
      { kind: 'api.enabled', count: 1 },
      { kind: 'api.disabled', count: 2 },
      { kind: 'api.scopes_changed', count: 1 },
      { kind: 'api.token_created', count: 3 },
      { kind: 'api.token_revoked', count: 4 },
      { kind: 'api.token_suspended', count: 1 },
      { kind: 'share.revoked', count: 1 },
      { kind: 'system.added', count: 5 },
    ];
    const summary = await auditActorSummary(1n, 'none');
    expect(summary.total).toBe(18);
    expect(summary.destructive).toBe(2 + 4 + 1);
    expect(summary.byCategory).toEqual({
      system: 5,
      connection: 0,
      signature: 0,
      note: 0,
      map: 0,
      access: 13,
    });
  });
});
