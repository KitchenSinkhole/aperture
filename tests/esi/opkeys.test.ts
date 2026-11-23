// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OP_KEYS } from '@/lib/esi/opkeys';

/**
 * This test makes the OpenAPI spec authoritative for the opKey→operationId pairings:
 * every operationId we name must exist in src/lib/esi/openapi.json,
 * so a typo or ESI schema drift fails loudly here rather than at runtime.
 */
const openapiPath = resolve(process.cwd(), 'src/lib/esi/openapi.json');
const openapi = readFileSync(openapiPath, 'utf8');

const operationIds = new Set(
  Array.from(openapi.matchAll(/"operationId":\s*"([A-Za-z][A-Za-z0-9]*)"/g), (m) => m[1]),
);

describe('ESI opKey map', () => {
  it('OpenAPI spec exposes operationIds', () => {
    expect(operationIds.size).toBeGreaterThan(100);
  });

  it.each(Object.entries(OP_KEYS))('%s → operationId exists in OpenAPI spec', (_opKey, def) => {
    expect(operationIds.has(def.operationId)).toBe(true);
  });
});
