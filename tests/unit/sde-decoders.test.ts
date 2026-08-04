import AdmZip from 'adm-zip';
import { getTableName } from 'drizzle-orm';
import { stringify } from 'yaml';
import { describe, expect, it } from 'vitest';
import { DELETION_SPECS, findShrunkenTables, parseSdeArchive } from '@/lib/sde/ingest';
import { SdeFormatError } from '@/lib/sde/decoders';

const CATEGORY = { 1: { name: 'Test Category', published: true } };
const GROUP = { 2: { categoryID: 1, name: 'Test Group', published: true } };
const DOGMA_ATTRIBUTE = { 3974: { name: 'scanWormholeStrength', published: true } };
const TYPES = {
  3001: { groupID: 2, name: 'Test Ore', published: true },
  3002: { groupID: 988, name: 'Wormhole A001', published: false },
};
const TYPE_DOGMA = { 3002: { dogmaAttributes: [{ attributeID: 3974, value: 5 }] } };
const REGIONS = { 1000: { name: 'Test Region' } };
const CONSTELLATIONS = { 2000: { regionID: 1000, name: 'Test Constellation' } };
const SYSTEMS = {
  30000001: { constellationID: 2000, regionID: 1000, name: 'Alpha', securityStatus: 0.9 },
  30000002: { constellationID: 2000, regionID: 1000, name: 'Bravo', securityStatus: 0.9 },
};
const STARGATES = {
  40000001: { solarSystemID: 30000001, destination: { solarSystemID: 30000002 } },
  40000002: { solarSystemID: 30000002, destination: { solarSystemID: 30000001 } },
};

/** Builds a minimal valid SDE archive, with any entry overridable for a negative case. */
function buildArchive(overrides: Record<string, unknown> = {}): AdmZip {
  const zip = new AdmZip();
  const entries: Record<string, unknown> = {
    'categories.yaml': CATEGORY,
    'groups.yaml': GROUP,
    'dogmaAttributes.yaml': DOGMA_ATTRIBUTE,
    'types.yaml': TYPES,
    'typeDogma.yaml': TYPE_DOGMA,
    'mapRegions.yaml': REGIONS,
    'mapConstellations.yaml': CONSTELLATIONS,
    'mapSolarSystems.yaml': SYSTEMS,
    'mapStargates.yaml': STARGATES,
    ...overrides,
  };
  for (const [name, value] of Object.entries(entries)) {
    if (value === undefined) continue; // allows a caller to omit an entry entirely
    const content = typeof value === 'string' ? value : stringify(value);
    zip.addFile(name, Buffer.from(content, 'utf-8'));
  }
  return zip;
}

describe('parseSdeArchive', () => {
  it('parses a minimal valid archive into rows with no DB access', () => {
    const parsed = parseSdeArchive(buildArchive());

    expect(parsed.categories).toHaveLength(1);
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.dogmaAttributes).toHaveLength(1);
    expect(parsed.typeIds.size).toBe(2);
    expect(parsed.typeAttributes).toEqual([{ typeId: 3002, attributeId: 3974, value: 5 }]);
    expect(parsed.regions).toHaveLength(1);
    expect(parsed.constellations).toHaveLength(1);
    expect(parsed.systemIds.size).toBe(2);
    expect(parsed.stargateEdges).toHaveLength(2);
    expect(parsed.wormholeCodeEntries).toEqual([{ code: 'A001', typeId: 3002 }]);
    expect(parsed.systemNameToId.get('Alpha')).toBe(30000001);
  });

  it('throws SdeFormatError naming the file on a truncated (structurally invalid) YAML file', () => {
    // Valid YAML, wrong shape: a flow-sequence where the file must be a keyed map.
    try {
      parseSdeArchive(buildArchive({ 'mapStargates.yaml': '[1, 2, 3]' }));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SdeFormatError);
      expect((err as SdeFormatError).file).toBe('mapStargates.yaml');
    }
  });

  it('throws SdeFormatError naming the file, entry, and field path when a required key is renamed', () => {
    const renamed = {
      40000001: { solar_system_id: 30000001, destination: { solarSystemID: 30000002 } },
    };
    try {
      parseSdeArchive(buildArchive({ 'mapStargates.yaml': renamed }));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SdeFormatError);
      const e = err as SdeFormatError;
      expect(e.file).toBe('mapStargates.yaml');
      expect(e.entryKey).toBe('40000001');
      expect(e.message).toContain('solarSystemID');
    }
  });

  it('throws when a zip entry is missing entirely', () => {
    expect(() =>
      parseSdeArchive(buildArchive({ 'mapConstellations.yaml': undefined })),
    ).toThrow(SdeFormatError);
  });

  it('throws when a file is a list rather than a map keyed by id', () => {
    try {
      parseSdeArchive(buildArchive({ 'categories.yaml': [{ name: 'oops' }] }));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SdeFormatError);
      expect((err as SdeFormatError).file).toBe('categories.yaml');
    }
  });
});

describe('findShrunkenTables', () => {
  const maxPct = 5;

  it('reports nothing within the threshold', () => {
    const live = { universe_type: 1000 };
    const next = { universe_type: 960 }; // -4%
    expect(findShrunkenTables(next, live, maxPct)).toEqual([]);
  });

  it('reports a table that shrinks past the threshold', () => {
    const live = { universe_type: 1000 };
    const next = { universe_type: 900 }; // -10%
    const offenders = findShrunkenTables(next, live, maxPct);
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toMatchObject({ table: 'universe_type', live: 1000, next: 900 });
    expect(offenders[0]!.pctShrink).toBeCloseTo(10);
  });

  it('skips a table whose live count is 0 (bootstrap, not a shrink)', () => {
    const live = { universe_type: 0 };
    const next = { universe_type: 0 };
    expect(findShrunkenTables(next, live, maxPct)).toEqual([]);
  });

  it('reports every offending table together', () => {
    const live = { universe_type: 1000, universe_system: 500, universe_region: 100 };
    const next = { universe_type: 900, universe_system: 499, universe_region: 50 };
    const offenders = findShrunkenTables(next, live, maxPct);
    expect(offenders.map((o) => o.table).sort()).toEqual(['universe_region', 'universe_type']);
  });

  it('treats a table missing from newCounts as fully absent', () => {
    const live = { universe_type: 1000 };
    const next: Record<string, number> = {};
    const offenders = findShrunkenTables(next, live, maxPct);
    expect(offenders).toEqual([{ table: 'universe_type', live: 1000, next: 0, pctShrink: 100 }]);
  });
});

describe('DELETION_SPECS ordering', () => {
  it('processes every guarded table leaf-first: a spec never guards on a table synced later than itself', () => {
    const indexByTableName = new Map(DELETION_SPECS.map((spec, i) => [spec.name, i]));

    for (const [i, spec] of DELETION_SPECS.entries()) {
      for (const guard of spec.guards) {
        const guardedIndex = indexByTableName.get(getTableName(guard.table));
        if (guardedIndex === undefined) continue; // not itself under deletion sync (e.g. an ap_* table) — no ordering constraint
        expect(
          guardedIndex,
          `${spec.name} guards on ${getTableName(guard.table)}, which is synced later (index ${guardedIndex} >= ${i})`,
        ).toBeLessThan(i);
      }
    }
  });
});
