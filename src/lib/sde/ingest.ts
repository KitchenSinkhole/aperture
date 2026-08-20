import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import StreamZip from 'node-stream-zip';
import { parse as parseCsv } from 'csv-parse/sync';
import { and, eq, ne, notExists, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import { apertureConfig } from '../../../aperture.config';
import { db, pool } from '@/db/client';
import {
  apMapConnectionLog,
  apMapSignature,
  apMapSystem,
  apRouteDestination,
  apSdeState,
  apStructure,
  apSystemStats,
  universeCategory,
  universeConstellation,
  universeDogmaAttribute,
  universeFactionWarSystem,
  universeGroup,
  universeIncursion,
  universeRegion,
  universeSdeStage,
  universeSovereigntyMap,
  universeStargateEdge,
  universeSystem,
  universeSystemStatic,
  universeType,
  universeTypeAttribute,
  universeTypeOverride,
  universeWormhole,
} from '@/db/schema';
import {
  decodeJsonlEntries,
  SdeFormatError,
  sdeCategorySchema,
  sdeConstellationSchema,
  sdeDogmaAttributeSchema,
  sdeGroupSchema,
  sdeLatestManifestSchema,
  sdeRegionSchema,
  sdeSolarSystemSchema,
  sdeStargateSchema,
  sdeTypeDogmaSchema,
  sdeTypeSchema,
} from './decoders';
import { deriveSecurityLabel, roundSecurity } from './security';
import { computeHubProximity } from './hubProximity';
import { SYSTEM_EFFECT_BY_ID } from '@/lib/eve/systemEffectAssignments';
import { drifterClassLabel } from '@/lib/eve/drifterSystems';

/**
 * Bootstrap-floor Tranquility SDE build: what a fresh database is seeded with
 * (reproducible bootstrap, cached zip, known-good CSV binding), not a ceiling
 * — the `sde-refresh` job (`src/lib/jobs/tasks/sdeRefresh.ts`) advances a
 * running deployment past it as CCP publishes new builds. Bump deliberately,
 * re-running the smoke test against the new counts.
 *
 * Source of truth + automation: https://developers.eveonline.com/docs/services/static-data
 * Latest build manifest: `SDE_LATEST_MANIFEST_URL` (key `sde`).
 */
export const SDE_BUILD = 3453885;
export const SDE_RELEASE_DATE = '2026-07-31';
const SDE_BASE = 'https://developers.eveonline.com/static-data/tranquility';
function sdeZipUrl(build: number): string {
  return `${SDE_BASE}/eve-online-static-data-${build}-jsonl.zip`;
}
export const SDE_ZIP_URL = sdeZipUrl(SDE_BUILD);
export const SDE_LATEST_MANIFEST_URL = `${SDE_BASE}/latest.jsonl`;

const DOGMA_ATTR_SCAN_WORMHOLE_STRENGTH = 3974;
const WORMHOLE_GROUP_ID = 988;
const OVERRIDE_REASON = 'esi-missing-3974';
const CHUNK = 1000;
const MANIFEST_FETCH_TIMEOUT_MS = 30_000;
/** Hard cap on a ~100MB zip download. A stalled CDN connection must not hang the ingest child forever. */
const ZIP_FETCH_TIMEOUT_MS = 10 * 60_000;
/** Floor below which a cached zip is treated as truncated without opening it. The real archive is ~100MB. */
const MIN_SDE_ZIP_BYTES = 1_000_000;

const CACHE_DIR = join(process.cwd(), '.sde-cache');
const DATA_DIR = join(process.cwd(), 'scripts', 'data');

type Loc = string | number | Record<string, string | number> | undefined | null;

function en(value: Loc): string | null {
  if (value == null) return null;
  if (typeof value !== 'object') return String(value);
  const v = value.en ?? Object.values(value)[0] ?? null;
  return v == null ? null : String(v);
}

function chunk<T>(rows: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Build an `onConflictDoUpdate` SET that copies the inserted row's columns. */
function excluded<T extends PgTable>(table: T, cols: string[]): Record<string, SQL> {
  const set: Record<string, SQL> = {};
  const columns = table as unknown as Record<string, { name: string } | undefined>;
  for (const c of cols) {
    const col = columns[c];
    if (!col) throw new Error(`Unknown column ${c} on table`);
    set[c] = sql.raw(`excluded."${col.name}"`);
  }
  return set;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Byte size of `p`, or null when it doesn't exist. */
async function fileSize(p: string): Promise<number | null> {
  try {
    return (await stat(p)).size;
  } catch {
    return null;
  }
}

async function unlinkIfPresent(p: string): Promise<void> {
  try {
    await unlink(p);
  } catch {
    // already gone, or held by something else — the caller re-downloads either way
  }
}

function sdeZipPath(build: number): string {
  return join(CACHE_DIR, `sde-${build}-jsonl.zip`);
}

/**
 * Downloads `build`'s zip into the cache, unconditionally and to a
 * process-private `.part` file that is renamed onto the cache path only once
 * the stream has completed and its length has been verified. An interrupted or
 * short download therefore never leaves anything a later run would mistake for
 * a complete archive, and two concurrent downloaders of the same build cannot
 * interleave their bytes.
 */
async function downloadSdeZip(build: number): Promise<string> {
  const dest = sdeZipPath(build);
  const part = `${dest}.${process.pid}.part`;
  await mkdir(CACHE_DIR, { recursive: true });
  const url = sdeZipUrl(build);
  console.log(`Downloading SDE build ${build} from ${url} ...`);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ZIP_FETCH_TIMEOUT_MS) });
    if (!res.ok || !res.body) throw new Error(`SDE download failed: HTTP ${res.status}`);
    const declared = Number(res.headers.get('content-length'));
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(part));
    const written = (await fileSize(part)) ?? 0;
    if (Number.isFinite(declared) && declared > 0 && written !== declared) {
      throw new Error(`SDE download truncated: expected ${declared} bytes, wrote ${written}`);
    }
    if (written < MIN_SDE_ZIP_BYTES) {
      throw new Error(`SDE download implausibly small: ${written} bytes`);
    }
    await rename(part, dest);
  } catch (err) {
    await unlinkIfPresent(part);
    throw err;
  }
  return dest;
}

/**
 * Returns the path to `build`'s cached zip, downloading it if absent. Defaults
 * to the pinned bootstrap build. A cached file below `MIN_SDE_ZIP_BYTES` is
 * treated as debris from an older, non-atomic download and replaced rather
 * than handed on.
 */
export async function ensureSdeZip(build: number = SDE_BUILD): Promise<string> {
  const dest = sdeZipPath(build);
  const size = await fileSize(dest);
  if (size != null && size >= MIN_SDE_ZIP_BYTES) return dest;
  if (size != null) {
    console.warn(`Cached SDE zip for build ${build} is only ${size} bytes — discarding and re-downloading.`);
    await unlinkIfPresent(dest);
  }
  return downloadSdeZip(build);
}

const CACHE_ZIP_NAME = /^sde-(\d+)-jsonl\.zip$/;
const CACHE_PART_NAME = /^sde-\d+-jsonl\.zip\.\d+\.part$/;

/**
 * Deletes every cached SDE zip except `keepBuild`'s, plus any `.part` file no
 * longer being written to, so a self-refreshing deployment doesn't accumulate
 * one ~100MB file per historical build or per hard-killed download. Called
 * after a successful `runIngest` so `keepBuild` (the build just written) is
 * never at risk; a `.part` younger than the download timeout belongs to a live
 * download and is left alone. Best-effort: a stray unremovable file logs a
 * warning rather than failing an otherwise-successful ingest.
 */
async function evictSupersededSdeZips(keepBuild: number): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(CACHE_DIR);
  } catch {
    return; // cache dir doesn't exist — nothing to evict
  }
  const partCutoff = Date.now() - ZIP_FETCH_TIMEOUT_MS;
  for (const entry of entries) {
    const path = join(CACHE_DIR, entry);
    if (CACHE_PART_NAME.test(entry)) {
      try {
        if ((await stat(path)).mtimeMs > partCutoff) continue;
      } catch {
        continue;
      }
    } else {
      const match = CACHE_ZIP_NAME.exec(entry);
      if (!match || Number(match[1]) === keepBuild) continue;
    }
    try {
      await unlink(path);
    } catch (err) {
      console.warn(`Failed to evict superseded SDE cache entry ${entry}: ${(err as Error).message}`);
    }
  }
}

/**
 * Fetches and parses `SDE_LATEST_MANIFEST_URL` (`{ "_key": "sde", "buildNumber": …,
 * "releaseDate": … }` newline-delimited JSON), returning the `sde` line. Throws
 * on an HTTP failure or a manifest with no `sde` entry — both are format drift
 * `sde-refresh` must fail loudly on rather than silently skip a check.
 */
export async function fetchLatestSdeManifest(): Promise<{ build: number; releaseDate: string }> {
  const res = await fetch(SDE_LATEST_MANIFEST_URL, {
    signal: AbortSignal.timeout(MANIFEST_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`SDE latest-manifest fetch failed: HTTP ${res.status}`);
  const text = await res.text();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const parsed = sdeLatestManifestSchema.safeParse(json);
    if (parsed.success && parsed.data._key === 'sde') {
      return { build: parsed.data.buildNumber, releaseDate: parsed.data.releaseDate.slice(0, 10) };
    }
  }
  throw new SdeFormatError('latest.jsonl', 'sde', 'no "sde" entry found');
}

/** Opens `entry` as a stream straight out of the archive, for `decodeJsonlEntries` to read without ever holding the whole decompressed entry in memory. */
type SdeEntryOpener = (entry: string) => Promise<NodeJS.ReadableStream>;

/** Builds an `SdeEntryOpener` bound to `zip`'s already-fetched entry index, so a missing entry is a name-map lookup rather than a failed read. */
function openerFor(zip: InstanceType<typeof StreamZip.async>, names: Set<string>): SdeEntryOpener {
  return async (entry: string) => {
    if (!names.has(entry)) throw new SdeFormatError(entry, '<root>', 'zip entry missing');
    return zip.stream(entry);
  };
}

/** Thrown by a gate that must block a write: an unresolvable CSV binding, a per-table shrink past `SDE_REFRESH_MAX_SHRINK_PCT`, a build older than the one the database holds, or another ingest already holding the run lock. Every code but `shrink` is raised before the write phase; the deletion-sync `shrink` gate runs after it, inside the transaction it aborts. */
export class SdeGateError extends Error {
  constructor(
    public readonly code: 'binding' | 'shrink' | 'downgrade' | 'concurrent',
    message: string,
  ) {
    super(message);
    this.name = 'SdeGateError';
  }
}

// --- Parse phase (no DB access) -------------------------------------------

async function parseCategories(open: SdeEntryOpener) {
  const rows: { id: number; name: string; published: boolean | null }[] = [];
  await decodeJsonlEntries('categories.jsonl', await open('categories.jsonl'), sdeCategorySchema, (id, c) => {
    rows.push({ id, name: en(c.name) ?? '', published: c.published ?? null });
  });
  return rows;
}

async function parseGroups(open: SdeEntryOpener) {
  const rows: { id: number; categoryId: number; name: string; published: boolean | null }[] = [];
  await decodeJsonlEntries('groups.jsonl', await open('groups.jsonl'), sdeGroupSchema, (id, g) => {
    rows.push({ id, categoryId: g.categoryID, name: en(g.name) ?? '', published: g.published ?? null });
  });
  return rows;
}

async function parseDogmaAttributes(open: SdeEntryOpener) {
  const rows: {
    id: number;
    name: string | null;
    displayName: string | null;
    description: string | null;
    published: boolean | null;
    stackable: boolean | null;
    highIsGood: boolean | null;
    defaultValue: number | null;
    iconId: number | null;
    unitId: number | null;
  }[] = [];
  await decodeJsonlEntries(
    'dogmaAttributes.jsonl',
    await open('dogmaAttributes.jsonl'),
    sdeDogmaAttributeSchema,
    (id, a) => {
      rows.push({
        id,
        name: en(a.name),
        displayName: en(a.displayName),
        description: en(a.description),
        published: a.published ?? null,
        stackable: a.stackable ?? null,
        highIsGood: a.highIsGood ?? null,
        defaultValue: a.defaultValue ?? null,
        iconId: a.iconID ?? null,
        unitId: a.unitID ?? null,
      });
    },
  );
  return rows;
}

/**
 * The SDE ships duplicate `Wormhole <CODE>` types in group 988 (e.g. two "Wormhole
 * J244", ids 30667 & 73748, dogma-identical and both unpublished — ESI won't
 * disambiguate them either). The vendored catalog/override CSVs key on the code, so
 * a collision MUST resolve to the same typeId the statics use: otherwise the
 * routing/override binds to an id no `universe_system_static` row references and the
 * static silently drops from the UI. Prefer the id present in the new build's
 * system-static rows; warn only if both collide there.
 */
function buildWormholeCodeToTypeId(
  entries: { code: string; typeId: number }[],
  staticTypeIds: Set<number>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const { code, typeId } of entries) {
    const key = code.toUpperCase();
    const existing = map.get(key);
    if (existing == null || existing === typeId) {
      map.set(key, typeId);
      continue;
    }
    const existingStatic = staticTypeIds.has(existing);
    const candidateStatic = staticTypeIds.has(typeId);
    if (candidateStatic && existingStatic) {
      console.warn(
        `  WH code ${key}: duplicate types ${existing} & ${typeId} are both referenced by statics — keeping ${existing}.`,
      );
    } else if (candidateStatic && !existingStatic) {
      map.set(key, typeId);
    }
    // else: keep existing — it is the static id, or neither id is (harmless, unused).
  }
  return map;
}

/**
 * Trailing token of a group-988 type name, which is the WH signature code.
 * CCP ships unpublished QA test holes ("QA Wormhole A"/"B") in that group whose
 * trailing token is a bare letter, not a code — they have no catalog row and
 * never will, so they are excluded rather than reported as uncatalogued.
 */
function wormholeCodeFromTypeName(name: string): string | null {
  if (name.startsWith('QA ')) return null;
  return name.split(' ').pop() || null;
}

async function parseTypes(open: SdeEntryOpener) {
  const typeIds = new Set<number>();
  const wormholeCodeEntries: { code: string; typeId: number }[] = [];
  const rows: {
    id: number;
    groupId: number;
    name: string;
    description: string | null;
    mass: number | null;
    volume: number | null;
    capacity: number | null;
    radius: number | null;
    packagedVolume: number | null;
    portionSize: number | null;
    marketGroupId: number | null;
    graphicId: number | null;
    published: boolean | null;
  }[] = [];
  await decodeJsonlEntries('types.jsonl', await open('types.jsonl'), sdeTypeSchema, (id, t) => {
    typeIds.add(id);
    const name = en(t.name) ?? '';
    if (t.groupID === WORMHOLE_GROUP_ID) {
      const code = wormholeCodeFromTypeName(name);
      if (code) wormholeCodeEntries.push({ code, typeId: id });
    }
    rows.push({
      id,
      groupId: t.groupID,
      name,
      description: en(t.description),
      mass: t.mass ?? null,
      volume: t.volume ?? null,
      capacity: t.capacity ?? null,
      radius: t.radius ?? null,
      packagedVolume: t.packagedVolume ?? null,
      portionSize: t.portionSize ?? null,
      marketGroupId: t.marketGroupID ?? null,
      graphicId: t.graphicID ?? null,
      published: t.published ?? null,
    });
  });
  return { rows, typeIds, wormholeCodeEntries };
}

async function parseTypeAttributes(open: SdeEntryOpener, typeIds: Set<number>, attrIds: Set<number>) {
  const rows: { typeId: number; attributeId: number; value: number | null }[] = [];
  await decodeJsonlEntries(
    'typeDogma.jsonl',
    await open('typeDogma.jsonl'),
    sdeTypeDogmaSchema,
    (typeId, entry) => {
      if (!typeIds.has(typeId)) return;
      for (const a of entry.dogmaAttributes ?? []) {
        if (!attrIds.has(a.attributeID)) continue;
        rows.push({ typeId, attributeId: a.attributeID, value: a.value ?? null });
      }
    },
  );
  return rows;
}

async function parseRegions(open: SdeEntryOpener) {
  const rows: { id: number; name: string; description: string | null }[] = [];
  await decodeJsonlEntries('mapRegions.jsonl', await open('mapRegions.jsonl'), sdeRegionSchema, (id, r) => {
    rows.push({ id, name: en(r.name) ?? String(id), description: en(r.description) });
  });
  return rows;
}

/** Returns rows plus a constellation id → wormholeClassID map for system security derivation. */
async function parseConstellations(open: SdeEntryOpener) {
  const whClass = new Map<number, number | null>();
  const rows: {
    id: number;
    regionId: number;
    name: string;
    x: number | null;
    y: number | null;
    z: number | null;
  }[] = [];
  await decodeJsonlEntries(
    'mapConstellations.jsonl',
    await open('mapConstellations.jsonl'),
    sdeConstellationSchema,
    (id, c) => {
      whClass.set(id, c.wormholeClassID ?? null);
      rows.push({
        id,
        regionId: c.regionID,
        name: en(c.name) ?? String(id),
        x: c.position?.x ?? null,
        y: c.position?.y ?? null,
        z: c.position?.z ?? null,
      });
    },
  );
  return { rows, whClass };
}

/** Returns rows, the set of system ids (stargate-edge filtering), and a name → id map (WH catalog `targetSystem` resolution). */
async function parseSystems(open: SdeEntryOpener, whClassByConstellation: Map<number, number | null>) {
  const systemIds = new Set<number>();
  const systemNameToId = new Map<string, number>();
  const rows: {
    id: number;
    constellationId: number;
    name: string;
    security: string;
    trueSec: number;
    securityStatus: number;
    securityClass: string | null;
    effect: string | null;
    x: number | null;
    y: number | null;
    z: number | null;
  }[] = [];
  await decodeJsonlEntries(
    'mapSolarSystems.jsonl',
    await open('mapSolarSystems.jsonl'),
    sdeSolarSystemSchema,
    (id, s) => {
      systemIds.add(id);
      const name = en(s.name) ?? String(id);
      systemNameToId.set(name, id);
      rows.push({
        id,
        constellationId: s.constellationID,
        name,
        // Drifter systems share one constellation post-2025, so their class can't
        // be derived from the constellation — pin C14–C18 by system id.
        security:
          drifterClassLabel(id) ??
          deriveSecurityLabel({
            regionId: s.regionID,
            wormholeClassId: whClassByConstellation.get(s.constellationID) ?? null,
            securityStatus: s.securityStatus,
          }),
        trueSec: roundSecurity(s.securityStatus),
        securityStatus: s.securityStatus,
        securityClass: en(s.securityClass),
        // SDE has no wormhole effect; layer it in from the vendored assignment map.
        effect: SYSTEM_EFFECT_BY_ID[id] ?? null,
        x: s.position?.x ?? null,
        y: s.position?.y ?? null,
        z: s.position?.z ?? null,
      });
    },
  );
  return { rows, systemIds, systemNameToId };
}

async function parseStargateEdges(open: SdeEntryOpener, systemIds: Set<number>) {
  const seen = new Set<string>();
  const rows: { fromSystemId: number; toSystemId: number }[] = [];
  await decodeJsonlEntries(
    'mapStargates.jsonl',
    await open('mapStargates.jsonl'),
    sdeStargateSchema,
    (_id, gate) => {
      const from = gate.solarSystemID;
      const to = gate.destination?.solarSystemID;
      if (to == null) return;
      if (!systemIds.has(from) || !systemIds.has(to)) return;
      const key = `${from}-${to}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({ fromSystemId: from, toSystemId: to });
    },
  );
  return rows;
}

export interface ParsedSde {
  categories: Awaited<ReturnType<typeof parseCategories>>;
  groups: Awaited<ReturnType<typeof parseGroups>>;
  dogmaAttributes: Awaited<ReturnType<typeof parseDogmaAttributes>>;
  attrIds: Set<number>;
  types: Awaited<ReturnType<typeof parseTypes>>['rows'];
  typeIds: Set<number>;
  wormholeCodeEntries: { code: string; typeId: number }[];
  typeAttributes: Awaited<ReturnType<typeof parseTypeAttributes>>;
  regions: Awaited<ReturnType<typeof parseRegions>>;
  constellations: Awaited<ReturnType<typeof parseConstellations>>['rows'];
  systems: Awaited<ReturnType<typeof parseSystems>>['rows'];
  systemIds: Set<number>;
  systemNameToId: Map<string, number>;
  stargateEdges: Awaited<ReturnType<typeof parseStargateEdges>>;
}

/**
 * Parses every SDE JSONL file into rows, entirely offline — no DB access. A
 * format-drift failure (`SdeFormatError`) or a truncated zip therefore always
 * happens before the write phase issues its first statement. Each entry is
 * streamed straight out of the archive and decoded one record at a time
 * (`decodeJsonlEntries`), so no whole-file document graph, whole-archive
 * buffer, or whole-decompressed-entry buffer is ever resident. The zip handle
 * is always closed before returning or throwing.
 */
export async function parseSdeArchive(zipPath: string): Promise<ParsedSde> {
  const zip = new StreamZip.async({ file: zipPath });
  try {
    const names = new Set(Object.keys(await zip.entries()));
    const open = openerFor(zip, names);

    const categories = await parseCategories(open);
    const groups = await parseGroups(open);
    const dogmaAttributes = await parseDogmaAttributes(open);
    const attrIds = new Set(dogmaAttributes.map((a) => a.id));
    const { rows: types, typeIds, wormholeCodeEntries } = await parseTypes(open);
    const typeAttributes = await parseTypeAttributes(open, typeIds, attrIds);
    const regions = await parseRegions(open);
    const { rows: constellations, whClass } = await parseConstellations(open);
    const { rows: systems, systemIds, systemNameToId } = await parseSystems(open, whClass);
    const stargateEdges = await parseStargateEdges(open, systemIds);

    return {
      categories,
      groups,
      dogmaAttributes,
      attrIds,
      types,
      typeIds,
      wormholeCodeEntries,
      typeAttributes,
      regions,
      constellations,
      systems,
      systemIds,
      systemNameToId,
      stargateEdges,
    };
  } finally {
    await zip.close();
  }
}

/**
 * Resolves `build` to a fully parsed archive, treating any failure to open or
 * decode the zip as a suspect artifact rather than a verdict on the build: the
 * cached file is deleted, and a zip that had been sitting in the cache is
 * re-downloaded and parsed once more before the error is allowed to stand. A
 * corrupt cache therefore heals inside the run that hits it, and a zip that
 * failed to parse is never left on disk for the next run to pick up.
 */
async function loadSdeBuild(build: number): Promise<ParsedSde> {
  const servedFromCache = ((await fileSize(sdeZipPath(build))) ?? 0) >= MIN_SDE_ZIP_BYTES;
  const zipPath = await ensureSdeZip(build);

  console.log('Parsing SDE archive ...');
  try {
    return await parseSdeArchive(zipPath);
  } catch (err) {
    await unlinkIfPresent(zipPath);
    if (!servedFromCache) throw err;
    console.warn(
      `Cached SDE zip for build ${build} failed to parse (${(err as Error).message}) — re-downloading and retrying once.`,
    );
    const fresh = await downloadSdeZip(build);
    try {
      return await parseSdeArchive(fresh);
    } catch (retryErr) {
      await unlinkIfPresent(fresh);
      throw retryErr;
    }
  }
}

// --- Vendored CSV parse phase (binds against the parsed build, not the DB) -

export interface CatalogBindings {
  systemIds: Set<number>;
  typeIds: Set<number>;
  systemNameToId: Map<string, number>;
  wormholeCodeEntries: { code: string; typeId: number }[];
}

export interface CsvRows {
  systemStatics: { systemId: number; typeId: number }[];
  typeOverrides: { typeId: number; attrId: number; value: number; reason: string }[];
  wormholeCatalog: {
    typeId: number;
    name: string;
    sourceClasses: string[] | null;
    targetClass: string | null;
    targetSystemId: number | null;
  }[];
}

async function readVendoredCsv(path: string): Promise<Record<string, string>[]> {
  if (!(await fileExists(path))) {
    throw new SdeGateError('binding', `${path} is missing`);
  }
  const text = await readFile(path, 'utf-8');
  return parseCsv(text, {
    columns: true,
    delimiter: ';',
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];
}

/**
 * Parses the three hand-maintained catalog CSVs (`scripts/data/`) and re-binds
 * every row against `bindings` (the build being ingested — the freshly parsed
 * archive for `runIngest`, or the live DB for `runCsvIngest`). A CSV row whose
 * system id, type id, or WH code no longer resolves is a hard failure
 * (`SdeGateError('binding')`): the CSVs are checked-in source of truth, so a
 * miss means the vendored data and the build have drifted, not that the row is
 * optional.
 */
export async function parseVendoredCsvs(bindings: CatalogBindings): Promise<CsvRows> {
  const systemStaticRecords = await readVendoredCsv(join(DATA_DIR, 'system-static.csv'));
  const seenStatics = new Set<string>();
  const systemStatics: CsvRows['systemStatics'] = [];
  for (const r of systemStaticRecords) {
    const systemId = Number(r.systemID ?? r.system_id ?? r.systemId);
    const typeId = Number(r.typeID ?? r.type_id ?? r.typeId);
    if (!Number.isFinite(systemId) || !bindings.systemIds.has(systemId)) {
      throw new SdeGateError(
        'binding',
        `system-static.csv: systemID ${r.systemID ?? r.system_id ?? r.systemId} not found in the new build's universe_system`,
      );
    }
    if (!Number.isFinite(typeId) || !bindings.typeIds.has(typeId)) {
      throw new SdeGateError(
        'binding',
        `system-static.csv: typeID ${r.typeID ?? r.type_id ?? r.typeId} not found in the new build's universe_type`,
      );
    }
    const key = `${systemId}-${typeId}`;
    if (seenStatics.has(key)) continue;
    seenStatics.add(key);
    systemStatics.push({ systemId, typeId });
  }

  const staticTypeIds = new Set(systemStatics.map((r) => r.typeId));
  const wormholeCodeToTypeId = buildWormholeCodeToTypeId(bindings.wormholeCodeEntries, staticTypeIds);

  const overrideRecords = await readVendoredCsv(join(DATA_DIR, 'wormhole-overrides.csv'));
  const typeOverrides: CsvRows['typeOverrides'] = [];
  for (const r of overrideRecords) {
    const raw = r.scanWormholeStrength;
    if (raw == null || raw === '') continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const code = r.Name?.toUpperCase();
    const typeId = code ? wormholeCodeToTypeId.get(code) : undefined;
    if (typeId == null) {
      throw new SdeGateError(
        'binding',
        `wormhole-overrides.csv: WH code ${r.Name} not found among the new build's group-${WORMHOLE_GROUP_ID} types`,
      );
    }
    typeOverrides.push({ typeId, attrId: DOGMA_ATTR_SCAN_WORMHOLE_STRENGTH, value, reason: OVERRIDE_REASON });
  }

  const catalogRecords = await readVendoredCsv(join(DATA_DIR, 'wormhole-classes.csv'));
  const wormholeCatalog: CsvRows['wormholeCatalog'] = [];
  for (const r of catalogRecords) {
    const code = r.code?.toUpperCase();
    if (!code) continue;
    const typeId = wormholeCodeToTypeId.get(code);
    if (typeId == null) {
      throw new SdeGateError(
        'binding',
        `wormhole-classes.csv: WH code ${code} not found among the new build's group-${WORMHOLE_GROUP_ID} types`,
      );
    }
    let targetSystemId: number | null = null;
    if (r.targetSystem) {
      const id = bindings.systemNameToId.get(r.targetSystem);
      if (id == null) {
        throw new SdeGateError(
          'binding',
          `wormhole-classes.csv: ${code} targetSystem "${r.targetSystem}" not found in the new build's universe_system`,
        );
      }
      targetSystemId = id;
    }
    wormholeCatalog.push({
      typeId,
      name: code,
      sourceClasses: r.sourceClasses ? r.sourceClasses.split('|') : null,
      targetClass: r.targetClass ? r.targetClass : null,
      targetSystemId,
    });
  }

  return { systemStatics, typeOverrides, wormholeCatalog };
}

// --- Shrink gate ------------------------------------------------------------

/** counts-object key → the table it gates. CSV-derived tables are exempt (their binding check above is strictly stronger, and a deliberate CSV row removal must not block a refresh). */
const SHRINK_GATE_KEY_TO_TABLE: Record<string, PgTable> = {
  categories: universeCategory,
  groups: universeGroup,
  dogmaAttributes: universeDogmaAttribute,
  types: universeType,
  typeAttributes: universeTypeAttribute,
  regions: universeRegion,
  constellations: universeConstellation,
  systems: universeSystem,
  stargateEdges: universeStargateEdge,
};

export interface ShrunkenTable {
  table: string;
  live: number;
  next: number;
  pctShrink: number;
}

/**
 * Pure comparison: which gated tables in `liveCounts` drop more than `maxPct`
 * in `newCounts`. A live count of 0 is a bootstrap, not a shrink, and is
 * skipped.
 */
export function findShrunkenTables(
  newCounts: Record<string, number>,
  liveCounts: Record<string, number>,
  maxPct: number,
): ShrunkenTable[] {
  const offenders: ShrunkenTable[] = [];
  for (const [table, live] of Object.entries(liveCounts)) {
    if (live === 0) continue;
    const next = newCounts[table] ?? 0;
    const pctShrink = ((live - next) / live) * 100;
    if (pctShrink > maxPct) offenders.push({ table, live, next, pctShrink });
  }
  return offenders;
}

/** Fails the ingest before any write if a gated table would shrink past `SDE_REFRESH_MAX_SHRINK_PCT`. */
async function assertNoExcessiveShrink(build: number, newCounts: Record<string, number>) {
  const liveCounts: Record<string, number> = {};
  for (const [key, table] of Object.entries(SHRINK_GATE_KEY_TO_TABLE)) {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
    liveCounts[key] = row?.n ?? 0;
  }
  const offenders = findShrunkenTables(newCounts, liveCounts, apertureConfig.SDE_REFRESH_MAX_SHRINK_PCT);
  if (offenders.length > 0) {
    const detail = offenders
      .map((o) => `${o.table}: ${o.live} -> ${o.next} (-${o.pctShrink.toFixed(1)}%)`)
      .join('; ');
    throw new SdeGateError(
      'shrink',
      `SDE build ${build} shrinks beyond ${apertureConfig.SDE_REFRESH_MAX_SHRINK_PCT}% on: ${detail}`,
    );
  }
}

// --- Write phase -------------------------------------------------------------

async function writeCategories(rows: ParsedSde['categories']) {
  for (const c of chunk(rows)) {
    await db
      .insert(universeCategory)
      .values(c)
      .onConflictDoUpdate({
        target: universeCategory.id,
        set: excluded(universeCategory, ['name', 'published']),
      });
  }
}

async function writeGroups(rows: ParsedSde['groups']) {
  for (const c of chunk(rows)) {
    await db
      .insert(universeGroup)
      .values(c)
      .onConflictDoUpdate({
        target: universeGroup.id,
        set: excluded(universeGroup, ['categoryId', 'name', 'published']),
      });
  }
}

async function writeDogmaAttributes(rows: ParsedSde['dogmaAttributes']) {
  for (const c of chunk(rows)) {
    await db
      .insert(universeDogmaAttribute)
      .values(c)
      .onConflictDoUpdate({
        target: universeDogmaAttribute.id,
        set: excluded(universeDogmaAttribute, [
          'name',
          'displayName',
          'description',
          'published',
          'stackable',
          'highIsGood',
          'defaultValue',
          'iconId',
          'unitId',
        ]),
      });
  }
}

async function writeTypes(rows: ParsedSde['types']) {
  for (const c of chunk(rows)) {
    await db
      .insert(universeType)
      .values(c)
      .onConflictDoUpdate({
        target: universeType.id,
        set: excluded(universeType, [
          'groupId',
          'name',
          'description',
          'mass',
          'volume',
          'capacity',
          'radius',
          'packagedVolume',
          'portionSize',
          'marketGroupId',
          'graphicId',
          'published',
        ]),
      });
  }
}

async function writeTypeAttributes(rows: ParsedSde['typeAttributes']) {
  for (const c of chunk(rows)) {
    await db
      .insert(universeTypeAttribute)
      .values(c)
      .onConflictDoUpdate({
        target: [universeTypeAttribute.typeId, universeTypeAttribute.attributeId],
        set: excluded(universeTypeAttribute, ['value']),
      });
  }
}

async function writeRegions(rows: ParsedSde['regions']) {
  for (const c of chunk(rows)) {
    await db
      .insert(universeRegion)
      .values(c)
      .onConflictDoUpdate({
        target: universeRegion.id,
        set: excluded(universeRegion, ['name', 'description']),
      });
  }
}

async function writeConstellations(rows: ParsedSde['constellations']) {
  for (const c of chunk(rows)) {
    await db
      .insert(universeConstellation)
      .values(c)
      .onConflictDoUpdate({
        target: universeConstellation.id,
        set: excluded(universeConstellation, ['regionId', 'name', 'x', 'y', 'z']),
      });
  }
}

async function writeSystems(rows: ParsedSde['systems']) {
  for (const c of chunk(rows)) {
    await db
      .insert(universeSystem)
      .values(c)
      .onConflictDoUpdate({
        target: universeSystem.id,
        set: excluded(universeSystem, [
          'constellationId',
          'name',
          'security',
          'trueSec',
          'securityStatus',
          'securityClass',
          'effect',
          'x',
          'y',
          'z',
        ]),
      });
  }
}

async function writeStargateEdges(rows: ParsedSde['stargateEdges']) {
  for (const c of chunk(rows)) {
    await db.insert(universeStargateEdge).values(c).onConflictDoNothing();
  }
}

/** Reseeds authoritatively (full delete then insert) inside one transaction — the table is fully derived from the CSV, and an untransacted delete-then-fail would leave it empty. */
async function writeSystemStatics(rows: CsvRows['systemStatics']) {
  await db.transaction(async (tx) => {
    await tx.delete(universeSystemStatic);
    for (const c of chunk(rows)) {
      await tx.insert(universeSystemStatic).values(c).onConflictDoNothing();
    }
  });
}

/** Reseeds authoritatively (delete-by-reason then insert) inside one transaction so a mid-insert failure can't leave the overrides deleted but not replaced. */
async function writeTypeOverrides(rows: CsvRows['typeOverrides']) {
  await db.transaction(async (tx) => {
    await tx.delete(universeTypeOverride).where(eq(universeTypeOverride.reason, OVERRIDE_REASON));
    for (const c of chunk(rows)) {
      await tx
        .insert(universeTypeOverride)
        .values(c)
        .onConflictDoUpdate({
          target: [universeTypeOverride.typeId, universeTypeOverride.attrId],
          set: { value: sql.raw('excluded."value"'), reason: sql.raw('excluded."reason"') },
        });
    }
  });
}

/** Reseeds authoritatively (full delete then insert) inside one transaction — the table is fully derived from the CSV, and an untransacted delete-then-fail would leave it empty. */
async function writeWormholeCatalog(rows: CsvRows['wormholeCatalog']) {
  await db.transaction(async (tx) => {
    await tx.delete(universeWormhole);
    for (const c of chunk(rows)) {
      await tx
        .insert(universeWormhole)
        .values(c)
        .onConflictDoUpdate({
          target: universeWormhole.typeId,
          set: excluded(universeWormhole, ['name', 'sourceClasses', 'targetClass', 'targetSystemId']),
        });
    }
  });
}

// --- Deletion sync ------------------------------------------------------------

/**
 * Stages `rows`' keys into `universe_sde_stage` under `runId` /
 * `tableName`, chunked so peak JS cost is one chunk of stage objects, never
 * the whole table.
 */
async function stageKeys<T>(
  runId: string,
  tableName: string,
  rows: T[],
  key: (row: T) => readonly [number, number | null],
): Promise<void> {
  for (const c of chunk(rows)) {
    await db.insert(universeSdeStage).values(
      c.map((row) => {
        const [idA, idB] = key(row);
        return { runId, tableName, idA, idB };
      }),
    );
  }
}

/**
 * Sweeps any other run's rows (an abandoned attempt, or a `pnpm
 * sde:bootstrap` overlapping a job-driven refresh — the two are not
 * mutually excluded by `SDE_QUEUE`), then stages this build's key set for
 * every table `syncSdeDeletions` covers.
 */
async function stageBuildKeys(runId: string, parsed: ParsedSde): Promise<void> {
  await db.delete(universeSdeStage).where(ne(universeSdeStage.runId, runId));
  await stageKeys(runId, 'universe_category', parsed.categories, (c) => [c.id, null]);
  await stageKeys(runId, 'universe_group', parsed.groups, (g) => [g.id, null]);
  await stageKeys(runId, 'universe_dogma_attribute', [...parsed.attrIds], (id) => [id, null]);
  await stageKeys(runId, 'universe_type', [...parsed.typeIds], (id) => [id, null]);
  await stageKeys(runId, 'universe_type_attribute', parsed.typeAttributes, (a) => [a.typeId, a.attributeId]);
  await stageKeys(runId, 'universe_region', parsed.regions, (r) => [r.id, null]);
  await stageKeys(runId, 'universe_constellation', parsed.constellations, (c) => [c.id, null]);
  await stageKeys(runId, 'universe_system', [...parsed.systemIds], (id) => [id, null]);
  await stageKeys(runId, 'universe_stargate_edge', parsed.stargateEdges, (e) => [e.fromSystemId, e.toSystemId]);
}

async function clearStagedBuildKeys(runId: string): Promise<void> {
  await db.delete(universeSdeStage).where(eq(universeSdeStage.runId, runId));
}

export interface SdeDeletionReport {
  /** db table name -> rows removed. */
  deleted: Record<string, number>;
  /** db table name -> rows kept despite being absent from the new build, because something still references them. `ids` is capped at `RETAINED_ORPHAN_SAMPLE`; `retained` is the true count. */
  retained: Record<string, { retained: number; ids: number[] }>;
}

const RETAINED_ORPHAN_SAMPLE = 50;

export interface DeletionGuard {
  table: PgTable;
  column: AnyPgColumn;
}

export interface DeletionSpec {
  /** db table name — the report key, and the `universe_sde_stage.table_name` discriminator. */
  name: string;
  table: PgTable;
  idColumn: AnyPgColumn;
  /** Set for the two composite-key tables; matched against `universe_sde_stage.id_b`. */
  idColumnB?: AnyPgColumn;
  guards: DeletionGuard[];
}

/**
 * One entry per SDE-derived table, in leaf-first processing order: every
 * table named in a `guards` entry is itself synced earlier in this list.
 * That ordering is what makes retention transitive for free — a system kept
 * alive by `ap_map_system` still has a live row when its constellation's
 * guard checks `universe_system.constellation_id`, so the constellation (and
 * in turn its region) is retained too, without any extra bookkeeping. It's
 * also why `universe_stargate_edge` and `universe_type_attribute` — which
 * have no inbound FKs of their own — sit first: `universe_system`'s guard
 * reads the former and `universe_type`/`universe_dogma_attribute`'s guards
 * read the latter, and both must see only the new build's rows.
 *
 * `universe_system.nearest_trade_hub_id` is deliberately not a guard: it's a
 * derived column `computeHubProximity` clears and recomputes after this runs,
 * and guarding on it would let a stale hub pointer pin a removed system
 * forever. FK-less soft references (`ap_structure_event.system_id`,
 * `ap_character.last_system_id`/`.last_ship_type_id`,
 * `universe_incursion.staging_solar_system_id`/`infested_solar_systems`,
 * `universe_killmail.body`) are excluded for the same reason — they already
 * tolerate ids the SDE snapshot lacks.
 */
export const DELETION_SPECS: DeletionSpec[] = [
  {
    name: 'universe_stargate_edge',
    table: universeStargateEdge,
    idColumn: universeStargateEdge.fromSystemId,
    idColumnB: universeStargateEdge.toSystemId,
    guards: [],
  },
  {
    name: 'universe_type_attribute',
    table: universeTypeAttribute,
    idColumn: universeTypeAttribute.typeId,
    idColumnB: universeTypeAttribute.attributeId,
    guards: [],
  },
  {
    name: 'universe_system',
    table: universeSystem,
    idColumn: universeSystem.id,
    guards: [
      { table: universeStargateEdge, column: universeStargateEdge.fromSystemId },
      { table: universeStargateEdge, column: universeStargateEdge.toSystemId },
      { table: universeSystemStatic, column: universeSystemStatic.systemId },
      { table: universeWormhole, column: universeWormhole.targetSystemId },
      { table: universeSovereigntyMap, column: universeSovereigntyMap.systemId },
      { table: universeFactionWarSystem, column: universeFactionWarSystem.systemId },
      { table: apMapSystem, column: apMapSystem.systemId },
      { table: apRouteDestination, column: apRouteDestination.systemId },
      { table: apStructure, column: apStructure.systemId },
      { table: apSystemStats, column: apSystemStats.systemId },
    ],
  },
  {
    name: 'universe_constellation',
    table: universeConstellation,
    idColumn: universeConstellation.id,
    guards: [
      { table: universeSystem, column: universeSystem.constellationId },
      { table: universeIncursion, column: universeIncursion.constellationId },
    ],
  },
  {
    name: 'universe_region',
    table: universeRegion,
    idColumn: universeRegion.id,
    guards: [{ table: universeConstellation, column: universeConstellation.regionId }],
  },
  {
    name: 'universe_type',
    table: universeType,
    idColumn: universeType.id,
    guards: [
      { table: universeTypeAttribute, column: universeTypeAttribute.typeId },
      { table: universeTypeOverride, column: universeTypeOverride.typeId },
      { table: universeSystemStatic, column: universeSystemStatic.typeId },
      { table: universeWormhole, column: universeWormhole.typeId },
      { table: apMapConnectionLog, column: apMapConnectionLog.shipTypeId },
      { table: apMapSignature, column: apMapSignature.typeId },
      { table: apStructure, column: apStructure.structureTypeId },
    ],
  },
  {
    name: 'universe_group',
    table: universeGroup,
    idColumn: universeGroup.id,
    guards: [{ table: universeType, column: universeType.groupId }],
  },
  {
    name: 'universe_category',
    table: universeCategory,
    idColumn: universeCategory.id,
    guards: [{ table: universeGroup, column: universeGroup.categoryId }],
  },
  {
    name: 'universe_dogma_attribute',
    table: universeDogmaAttribute,
    idColumn: universeDogmaAttribute.id,
    guards: [{ table: universeTypeAttribute, column: universeTypeAttribute.attributeId }],
  },
];

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Correlated `NOT EXISTS` against this run's staged key set for `spec`'s table. */
function absentFromStage(runId: string, spec: DeletionSpec) {
  return notExists(
    db
      .select({ one: sql<number>`1` })
      .from(universeSdeStage)
      .where(
        and(
          eq(universeSdeStage.runId, runId),
          eq(universeSdeStage.tableName, spec.name),
          eq(universeSdeStage.idA, spec.idColumn),
          ...(spec.idColumnB ? [eq(universeSdeStage.idB, spec.idColumnB)] : []),
        ),
      ),
  );
}

/**
 * Deletes `spec.table` rows absent from this run's staged key set and clear
 * of every guard, then measures what's left. Retention is measured *after*
 * the delete rather than by diffing beforehand: a later spec can only reach
 * an earlier spec's table through an `ON DELETE CASCADE` FK pointing at the
 * later table, which is exactly what the later table's guard already checks,
 * so leaf-first ordering makes each table's post-delete survivor count the
 * true retained set. Skipped for the two composite-key tables (`guards:
 * []`), whose retained count is provably zero.
 */
async function syncDeletionSpec(
  tx: Tx,
  runId: string,
  spec: DeletionSpec,
): Promise<{ name: string; deleted: number; retained: { retained: number; ids: number[] } | null }> {
  const guardConditions = spec.guards.map((g) =>
    notExists(db.select({ one: sql<number>`1` }).from(g.table).where(eq(g.column, spec.idColumn))),
  );

  const deleteResult = await tx.delete(spec.table).where(and(absentFromStage(runId, spec), ...guardConditions));
  const deleted = deleteResult.rowCount ?? 0;

  if (spec.guards.length === 0) {
    return { name: spec.name, deleted, retained: null };
  }

  const [retainedRow] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(spec.table)
    .where(absentFromStage(runId, spec));
  const retainedTotal = retainedRow?.n ?? 0;

  if (!retainedTotal) {
    return { name: spec.name, deleted, retained: null };
  }

  const sample = await tx
    .select({ id: spec.idColumn })
    .from(spec.table)
    .where(absentFromStage(runId, spec))
    .orderBy(spec.idColumn)
    .limit(RETAINED_ORPHAN_SAMPLE);

  return {
    name: spec.name,
    deleted,
    retained: { retained: retainedTotal, ids: sample.map((r) => r.id as number) },
  };
}

/**
 * Removes rows absent from this run's staged key set (`universe_sde_stage`,
 * populated by `stageBuildKeys` during the write phase) across the nine
 * SDE-derived `universe_*` tables, guarded per-table against every inbound FK
 * (not only `RESTRICT` ones — see `DELETION_SPECS`). Must run after the
 * write phase (the new build's own rows need to already be in place for the
 * anti-join and for `universe_wormhole` to be current as a guard) and before
 * `computeHubProximity` (which BFSes `universe_stargate_edge` and would bake
 * a removed gate into `nearest_trade_hub_jumps` otherwise).
 *
 * The empty-keep gate and all nine deletes share one `repeatable read`
 * snapshot, so the gate's verdict holds for every statement that follows it.
 * An overlapping run's `stageBuildKeys` sweep (which clears every other
 * `run_id` unconditionally) is therefore invisible once this transaction has
 * started; without that, a sweep landing mid-loop would empty the stage under
 * a run that had already passed the gate and every remaining spec would
 * anti-join against nothing — deleting `universe_stargate_edge` and
 * `universe_type_attribute` outright, neither of which has an FK guard. Two
 * runs deleting the same rows now surface as a serialization failure that
 * fails the ingest, and the all-or-nothing commit means a mid-loop error can
 * no longer leave the tables partially synced.
 */
export async function syncSdeDeletions(runId: string): Promise<SdeDeletionReport> {
  // Freshly staged rows have reset planner stats; table_name has exactly nine
  // distinct values, and without stats the default-distinct estimate can be
  // orders of magnitude off on that discriminator. Kept outside the
  // transaction so the stats survive a rollback.
  await db.execute(sql`ANALYZE "universe_sde_stage"`);

  return db.transaction(
    async (tx) => {
      const staged = await tx
        .select({ tableName: universeSdeStage.tableName, n: sql<number>`count(*)::int` })
        .from(universeSdeStage)
        .where(eq(universeSdeStage.runId, runId))
        .groupBy(universeSdeStage.tableName);
      const stagedCounts = new Map(staged.map((r) => [r.tableName, r.n]));
      for (const spec of DELETION_SPECS) {
        if (!stagedCounts.get(spec.name)) {
          throw new SdeGateError('shrink', `SDE deletion sync refuses to run with no staged keys for ${spec.name}`);
        }
      }

      const deleted: Record<string, number> = {};
      const retained: Record<string, { retained: number; ids: number[] }> = {};

      for (const spec of DELETION_SPECS) {
        const result = await syncDeletionSpec(tx, runId, spec);
        deleted[result.name] = result.deleted;
        if (result.retained) retained[result.name] = result.retained;
      }

      return { deleted, retained };
    },
    { isolationLevel: 'repeatable read' },
  );
}

export interface IngestResult {
  build: number;
  counts: Record<string, number>;
}

/**
 * Blocks an ingest of a build older than the one `ap_sde_state` records. The
 * write phase is upsert-only, but `syncSdeDeletions` runs against the older
 * build's staged keys and would remove every row the newer build added — new
 * systems, and stargate edges, which have no FK guard at all. The shrink gate
 * can't see it: a few dozen systems out of ~8k is far under
 * `SDE_REFRESH_MAX_SHRINK_PCT`.
 */
async function assertNotADowngrade(build: number): Promise<void> {
  const [row] = await db
    .select({ currentBuild: apSdeState.currentBuild })
    .from(apSdeState)
    .where(eq(apSdeState.id, 1));
  if (row?.currentBuild != null && build < row.currentBuild) {
    throw new SdeGateError(
      'downgrade',
      `SDE build ${build} is older than build ${row.currentBuild}, which this database already holds`,
    );
  }
}

/**
 * Records a failed static-data refresh onto the `ap_sde_state` singleton row,
 * so a failure is visible in `/setup` rather than only in `ap_job_run`. Shared
 * by the `sde-refresh` and `sde-ingest` tasks.
 */
export async function recordSdeFailure(reason: string): Promise<void> {
  const failedAt = new Date();
  await db
    .insert(apSdeState)
    .values({ id: 1, failedAt, failureReason: reason, consecutiveFailures: 1 })
    .onConflictDoUpdate({
      target: apSdeState.id,
      set: {
        failedAt,
        failureReason: reason,
        consecutiveFailures: sql`${apSdeState.consecutiveFailures} + 1`,
      },
    });
}

/** Records a successful full ingest onto the `ap_sde_state` singleton row. */
async function recordSdeIngestSuccess(
  build: number,
  releaseDate: string,
  retainedOrphans: Record<string, { retained: number; ids: number[] }>,
  uncatalogedWormholeCodes: string[],
) {
  const values = {
    currentBuild: build,
    currentReleaseDate: releaseDate,
    refreshedAt: new Date(),
    behindSince: null,
    failedAt: null,
    failureReason: null,
    consecutiveFailures: 0,
    retainedOrphans,
    uncatalogedWormholeCodes,
  };
  await db
    .insert(apSdeState)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: apSdeState.id, set: values });
}

/**
 * Re-runnable ingest of only the vendored CSV files (system statics,
 * attr-3974 overrides, WH catalog). Binds against the live DB rather than an
 * SDE zip, so it can run independently of sde:bootstrap.
 */
export async function runCsvIngest(): Promise<IngestResult> {
  const systemRows = await db
    .select({ id: universeSystem.id, name: universeSystem.name })
    .from(universeSystem);
  const systemIds = new Set(systemRows.map((r) => r.id));
  const systemNameToId = new Map(systemRows.map((r) => [r.name, r.id]));

  const typeRows = await db
    .select({ id: universeType.id, groupId: universeType.groupId, name: universeType.name })
    .from(universeType);
  const typeIds = new Set(typeRows.map((r) => r.id));
  const wormholeCodeEntries: { code: string; typeId: number }[] = [];
  for (const r of typeRows) {
    if (r.groupId === WORMHOLE_GROUP_ID) {
      const code = wormholeCodeFromTypeName(r.name ?? '');
      if (code) wormholeCodeEntries.push({ code, typeId: r.id });
    }
  }

  console.log('Ingesting vendored CSVs (system statics, overrides, wormhole catalog) ...');
  const csv = await parseVendoredCsvs({ systemIds, typeIds, systemNameToId, wormholeCodeEntries });

  await writeSystemStatics(csv.systemStatics);
  await writeTypeOverrides(csv.typeOverrides);
  await writeWormholeCatalog(csv.wormholeCatalog);

  return {
    build: SDE_BUILD,
    counts: {
      systemStatics: csv.systemStatics.length,
      typeOverrides: csv.typeOverrides.length,
      wormholes: csv.wormholeCatalog.length,
    },
  };
}

/**
 * Parses `build`, writes it, and stages its key set for deletion sync —
 * everything that needs the parsed row arrays resident. Returns only
 * primitives, so `parsed`/`csv` (the whole-build row arrays) become garbage
 * the moment this returns, rather than staying live for the rest of the
 * ingest.
 */
async function parseWriteAndStage(
  build: number,
  runId: string,
): Promise<{ counts: Record<string, number>; uncatalogedWormholeCodes: string[] }> {
  const parsed = await loadSdeBuild(build);

  console.log('Parsing vendored CSVs ...');
  const csv = await parseVendoredCsvs(parsed);

  const counts: Record<string, number> = {
    categories: parsed.categories.length,
    groups: parsed.groups.length,
    dogmaAttributes: parsed.dogmaAttributes.length,
    types: parsed.typeIds.size,
    typeAttributes: parsed.typeAttributes.length,
    regions: parsed.regions.length,
    constellations: parsed.constellations.length,
    systems: parsed.systemIds.size,
    stargateEdges: parsed.stargateEdges.length,
    systemStatics: csv.systemStatics.length,
    typeOverrides: csv.typeOverrides.length,
    wormholes: csv.wormholeCatalog.length,
  };

  console.log('Checking for excessive shrink against the live tables ...');
  await assertNoExcessiveShrink(build, counts);

  console.log('Writing categories, groups, dogma attributes ...');
  await writeCategories(parsed.categories);
  await writeGroups(parsed.groups);
  await writeDogmaAttributes(parsed.dogmaAttributes);

  console.log('Writing types + type attributes ...');
  await writeTypes(parsed.types);
  await writeTypeAttributes(parsed.typeAttributes);

  console.log('Writing regions, constellations, systems ...');
  await writeRegions(parsed.regions);
  await writeConstellations(parsed.constellations);
  await writeSystems(parsed.systems);

  console.log('Writing stargate edges ...');
  await writeStargateEdges(parsed.stargateEdges);

  console.log('Writing vendored CSVs (system statics, overrides, wormhole catalog) ...');
  await writeSystemStatics(csv.systemStatics);
  await writeTypeOverrides(csv.typeOverrides);
  await writeWormholeCatalog(csv.wormholeCatalog);

  console.log('Staging the new build for deletion sync ...');
  await stageBuildKeys(runId, parsed);

  const catalogedCodes = new Set(csv.wormholeCatalog.map((r) => r.name));
  const uncatalogedWormholeCodes = Array.from(
    new Set(parsed.wormholeCodeEntries.map((e) => e.code.toUpperCase())),
  )
    .filter((code) => !catalogedCodes.has(code))
    .sort();

  return { counts, uncatalogedWormholeCodes };
}

/**
 * Advisory-lock key serialising whole ingests across every entry point.
 * `SDE_QUEUE` mutually excludes the three job tasks, but `pnpm sde:bootstrap`
 * calls `runIngest` in-process and never reaches graphile-worker, so the queue
 * alone cannot stop a hand-run bootstrap from overlapping the daily refresh —
 * the case `stageBuildKeys`'s unconditional sweep of other runs' staged keys
 * exists to tolerate.
 */
const INGEST_LOCK_KEY = 'sde-ingest';

/**
 * Takes the ingest lock on a dedicated pooled client, held for the run's whole
 * duration. Session-scoped rather than transaction-scoped because an ingest is
 * hundreds of statements over many minutes, and pinned to one client because a
 * session lock belongs to the connection that took it — releasing it from
 * whichever connection the pool handed out next would fail. A killed or
 * crashed ingest drops its session, so the lock cannot outlive its holder.
 *
 * Fails fast rather than queueing: a second concurrent run would only re-ingest
 * the build the first is already writing, so waiting out a ~20 minute ingest
 * buys nothing an operator wants.
 */
async function acquireIngestLock(): Promise<{ release: () => Promise<void> }> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_lock(hashtextextended($1, 0)) as locked',
      [INGEST_LOCK_KEY],
    );
    if (!rows[0]?.locked) {
      throw new SdeGateError('concurrent', 'Another SDE ingest is already running against this database');
    }
  } catch (err) {
    client.release();
    throw err;
  }
  return {
    async release() {
      try {
        await client.query('select pg_advisory_unlock(hashtextextended($1, 0))', [INGEST_LOCK_KEY]);
      } finally {
        client.release();
      }
    },
  };
}

/**
 * One-shot, re-runnable ingest of an SDE build into every `universe_*` table —
 * the pinned bootstrap build by default, or `override.build` when called from
 * `sde-refresh` / `sde-ingest`. Rejects a build older than the one
 * `ap_sde_state` records, downloads the zip if absent, parses it and the
 * vendored CSVs fully (Zod decoders + CSV re-binding — format drift and an
 * unresolvable catalog row both fail here), checks for excessive per-table
 * shrink against the live tables, and only then writes — in FK-safe order,
 * upserts (re-runnable).
 *
 * Runs under the `sde-ingest` advisory lock, so two ingests can never interleave
 * whichever entry points they came from. The downgrade gate is inside the lock:
 * it reads `ap_sde_state.current_build`, which a concurrent run would advance.
 */
export async function runIngest(override?: { build: number; releaseDate: string }): Promise<IngestResult> {
  const build = override?.build ?? SDE_BUILD;
  const releaseDate = override?.releaseDate ?? SDE_RELEASE_DATE;

  const lock = await acquireIngestLock();
  const runId = randomUUID();
  try {
    try {
      await assertNotADowngrade(build);

      const { counts, uncatalogedWormholeCodes } = await parseWriteAndStage(build, runId);

      console.log('Syncing deletions against the new build ...');
      const deletion = await syncSdeDeletions(runId);
      for (const [table, n] of Object.entries(deletion.deleted)) {
        if (n > 0) console.log(`  deleted ${n} row(s) from ${table}`);
      }
      for (const [table, r] of Object.entries(deletion.retained)) {
        console.log(`  retained ${r.retained} row(s) in ${table} (still referenced)`);
      }
      counts.deleted = Object.values(deletion.deleted).reduce((a, b) => a + b, 0);
      counts.retainedOrphans = Object.values(deletion.retained).reduce((a, b) => a + b.retained, 0);

      console.log('Computing trade-hub proximity ...');
      counts.hubProximity = await computeHubProximity();
      counts.uncatalogedWormholes = uncatalogedWormholeCodes.length;

      await recordSdeIngestSuccess(build, releaseDate, deletion.retained, uncatalogedWormholeCodes);
      await evictSupersededSdeZips(build);

      return { build, counts };
    } finally {
      // A failed run's ~1.4M staged rows would otherwise sit in the (unlogged)
      // stage table until the next ingest's sweep — a full day of footprint for
      // nothing when a daily `sde-refresh` is the thing failing.
      await clearStagedBuildKeys(runId);
    }
  } finally {
    await lock.release();
  }
}
