import { describe, expect, it } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { apMap } from '@/db/schema/ap/map';

describe('ap_map experimental cleanup columns', () => {
  it('declares boolean columns with snake_case names', () => {
    const cols = getTableColumns(apMap);
    expect(cols.experimentalSignatureCleanup.name).toBe('experimental_signature_cleanup');
    expect(cols.experimentalMapCleanup.name).toBe('experimental_map_cleanup');
    expect(cols.experimentalSignatureCleanup.notNull).toBe(true);
    expect(cols.experimentalMapCleanup.notNull).toBe(true);
    expect(cols.experimentalSignatureCleanup.hasDefault).toBe(true);
    expect(cols.experimentalMapCleanup.hasDefault).toBe(true);
  });
});