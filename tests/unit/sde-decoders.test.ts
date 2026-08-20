import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { getTableName } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { DELETION_SPECS, findShrunkenTables, parseSdeArchive } from '@/lib/sde/ingest';
import { SdeFormatError } from '@/lib/sde/decoders';

const CATEGORY = { 1: { name: 'Test Category', published: true } };
const GROUP = { 2: { categoryID: 1, name: 'Test Group', published: true } };
const DOGMA_ATTRIBUTE = { 3974: { name: 'scanWormholeStrength', published: true } };
const TYPES = {
  3001: { groupID: 2, name: 'Test Ore', published: true },
  3002: { groupID: 988, name: 'Wormhole A001', published: false },
  3003: { groupID: 988, name: 'QA Wormhole A', published: false },
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

/** Renders a `{ id: entry }` map as `.jsonl` lines, each carrying its id as `_key` — the shape a real SDE JSONL file has. */
function toJsonl(map: Record<string, unknown>): string {
  return Object.entries(map)
    .map(([key, value]) => JSON.stringify({ _key: Number(key), ...(value as Record<string, unknown>) }))
    .join('\n');
}

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * Builds a minimal valid SDE archive on disk, with any entry overridable for
 * a negative case. A string override is written verbatim, letting a case
 * supply a single malformed or non-object line. Returns the zip's path —
 * `parseSdeArchive` streams entries out of a file, not an in-memory handle.
 */
async function buildArchive(overrides: Record<string, unknown> = {}): Promise<string> {
  const zip = new AdmZip();
  const entries: Record<string, unknown> = {
    'categories.jsonl': CATEGORY,
    'groups.jsonl': GROUP,
    'dogmaAttributes.jsonl': DOGMA_ATTRIBUTE,
    'types.jsonl': TYPES,
    'typeDogma.jsonl': TYPE_DOGMA,
    'mapRegions.jsonl': REGIONS,
    'mapConstellations.jsonl': CONSTELLATIONS,
    'mapSolarSystems.jsonl': SYSTEMS,
    'mapStargates.jsonl': STARGATES,
    ...overrides,
  };
  for (const [name, value] of Object.entries(entries)) {
    if (value === undefined) continue; // allows a caller to omit an entry entirely
    const content = typeof value === 'string' ? value : toJsonl(value as Record<string, unknown>);
    zip.addFile(name, Buffer.from(content, 'utf-8'));
  }
  const dir = await mkdtemp(join(tmpdir(), 'sde-fixture-'));
  tmpDirs.push(dir);
  const zipPath = join(dir, 'sde.zip');
  await zip.writeZipPromise(zipPath);
  return zipPath;
}

describe('parseSdeArchive', () => {
  it('parses a minimal valid archive into rows with no DB access', async () => {
    const parsed = await parseSdeArchive(await buildArchive());

    expect(parsed.categories).toHaveLength(1);
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.dogmaAttributes).toHaveLength(1);
    expect(parsed.typeIds.size).toBe(3);
    expect(parsed.typeAttributes).toEqual([{ typeId: 3002, attributeId: 3974, value: 5 }]);
    expect(parsed.regions).toHaveLength(1);
    expect(parsed.constellations).toHaveLength(1);
    expect(parsed.systemIds.size).toBe(2);
    expect(parsed.stargateEdges).toHaveLength(2);
    // CCP's QA test hole (3003) is a group-988 type row but not a WH code.
    expect(parsed.wormholeCodeEntries).toEqual([{ code: 'A001', typeId: 3002 }]);
    expect(parsed.systemNameToId.get('Alpha')).toBe(30000001);
  });

  it('throws SdeFormatError naming the file on a malformed (invalid JSON) line', async () => {
    try {
      await parseSdeArchive(await buildArchive({ 'categories.jsonl': '{not valid json' }));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SdeFormatError);
      expect((err as SdeFormatError).file).toBe('categories.jsonl');
    }
  });

  it('throws SdeFormatError naming the file when a line is not a JSON object', async () => {
    try {
      await parseSdeArchive(await buildArchive({ 'mapStargates.jsonl': '[1, 2, 3]' }));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SdeFormatError);
      expect((err as SdeFormatError).file).toBe('mapStargates.jsonl');
    }
  });

  it('throws SdeFormatError naming the file when a line has no "_key"', async () => {
    try {
      await parseSdeArchive(await buildArchive({ 'categories.jsonl': JSON.stringify({ name: 'oops' }) }));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SdeFormatError);
      expect((err as SdeFormatError).file).toBe('categories.jsonl');
    }
  });

  it('throws SdeFormatError naming the file, entry, and field path when a required key is renamed', async () => {
    const renamed = JSON.stringify({
      _key: 40000001,
      solar_system_id: 30000001,
      destination: { solarSystemID: 30000002 },
    });
    try {
      await parseSdeArchive(await buildArchive({ 'mapStargates.jsonl': renamed }));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SdeFormatError);
      const e = err as SdeFormatError;
      expect(e.file).toBe('mapStargates.jsonl');
      expect(e.entryKey).toBe('40000001');
      expect(e.message).toContain('solarSystemID');
    }
  });

  it('throws when a zip entry is missing entirely', async () => {
    await expect(parseSdeArchive(await buildArchive({ 'mapConstellations.jsonl': undefined }))).rejects.toThrow(
      SdeFormatError,
    );
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
