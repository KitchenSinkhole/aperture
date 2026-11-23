import { describe, expect, it } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { apMap } from '@/db/schema/ap/map';

describe('ap_map experimental signature cleanup column', () => {
  it('declares experimental_signature_cleanup', () => {
    const cols = getTableColumns(apMap);
    expect(cols.experimentalSignatureCleanup.name).toBe('experimental_signature_cleanup');
    expect(cols.experimentalSignatureCleanup.notNull).toBe(true);
    expect(cols.experimentalSignatureCleanup.hasDefault).toBe(true);
    expect(cols).not.toHaveProperty('experimentalMapCleanup');
  });
});