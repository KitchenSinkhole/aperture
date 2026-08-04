import { createWriteStream } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import AdmZip from 'adm-zip';
import { parse as parseCsv } from 'csv-parse/sync';
import { eq, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { parse as parseYaml } from 'yaml';
import { db } from '@/db/client';
import {
  apSdeState,
  universeCategory,
  universeConstellation,
  universeDogmaAttribute,
  universeGroup,
  universeRegion,
  universeStargateEdge,
  universeSystem,
  universeSystemStatic,
  universeType,
  universeTypeAttribute,
  universeTypeOverride,
  universeWormhole,
} from '@/db/schema';
import { deriveSecurityLabel, roundSecurity } from './security';
import { computeHubProximity } from './hubProximity';
import { SYSTEM_EFFECT_BY_ID } from '@/lib/eve/systemEffectAssignments';
import { drifterClassLabel } from '@/lib/eve/drifterSystems';

/**
 * Pinned Tranquility SDE build. CCP reorganizes the SDE periodically, so
 * pinning the build keeps ingest reproducible and the Phase-0 gate counts
 * stable. Bump deliberately, re-running the smoke test against the new counts.
 *
 * Source of truth + automation: https://developers.eveonline.com/docs/services/static-data
 * Latest build manifest: <SDE_BASE>/tranquility/latest.jsonl (key `sde`).
 */
export const SDE_BUILD = 3453885;
export const SDE_RELEASE_DATE = '2026-07-31';
const SDE_BASE = 'https://developers.eveonline.com/static-data/tranquility';
export const SDE_ZIP_URL = `${SDE_BASE}/eve-online-static-data-${SDE_BUILD}-yaml.zip`;

const DOGMA_ATTR_SCAN_WORMHOLE_STRENGTH = 3974;
const WORMHOLE_GROUP_ID = 988;
const OVERRIDE_REASON = 'esi-missing-3974';
const CHUNK = 1000;

const CACHE_DIR = join(process.cwd(), '.sde-cache');
const DATA_DIR = join(process.cwd(), 'scripts', 'data');

type Loc = string | Record<string, string> | undefined | null;
type Yaml = Record<string, Record<string, unknown>>;

function en(value: Loc): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  return value.en ?? Object.values(value)[0] ?? null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
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

/** Download the pinned SDE zip into the cache dir if not already present. */
export async function ensureSdeZip(): Promise<string> {
  const dest = join(CACHE_DIR, `sde-${SDE_BUILD}-yaml.zip`);
  if (await fileExists(dest)) return dest;
  await mkdir(CACHE_DIR, { recursive: true });
  console.log(`Downloading SDE build ${SDE_BUILD} from ${SDE_ZIP_URL} ...`);
  const res = await fetch(SDE_ZIP_URL);
  if (!res.ok || !res.body) throw new Error(`SDE download failed: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
  return dest;
}

function readYaml(zip: AdmZip, entry: string): Yaml {
  const buf = zip.getEntry(entry)?.getData();
  if (!buf) throw new Error(`SDE entry missing: ${entry}`);
  return parseYaml(buf.toString('utf-8')) as Yaml;
}

async function ingestCategories(zip: AdmZip) {
  const data = readYaml(zip, 'categories.yaml');
  const rows = Object.entries(data).map(([id, c]) => ({
    id: Number(id),
    name: en(c.name as Loc) ?? '',
    published: bool(c.published),
  }));
  for (const c of chunk(rows)) {
    await db
      .insert(universeCategory)
      .values(c)
      .onConflictDoUpdate({
        target: universeCategory.id,
        set: excluded(universeCategory, ['name', 'published']),
      });
  }
  return rows.length;
}

async function ingestGroups(zip: AdmZip) {
  const data = readYaml(zip, 'groups.yaml');
  const rows = Object.entries(data).map(([id, g]) => ({
    id: Number(id),
    categoryId: g.categoryID as number,
    name: en(g.name as Loc) ?? '',
    published: bool(g.published),
  }));
  for (const c of chunk(rows)) {
    await db
      .insert(universeGroup)
      .values(c)
      .onConflictDoUpdate({
        target: universeGroup.id,
        set: excluded(universeGroup, ['categoryId', 'name', 'published']),
      });
  }
  return rows.length;
}

async function ingestDogmaAttributes(zip: AdmZip): Promise<Set<number>> {
  const data = readYaml(zip, 'dogmaAttributes.yaml');
  const rows = Object.entries(data).map(([id, a]) => ({
    id: Number(id),
    name: en(a.name as Loc),
    displayName: en(a.displayName as Loc),
    description: en(a.description as Loc),
    published: bool(a.published),
    stackable: bool(a.stackable),
    highIsGood: bool(a.highIsGood),
    defaultValue: num(a.defaultValue),
    iconId: num(a.iconID),
    unitId: num(a.unitID),
  }));
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
  return new Set(rows.map((r) => r.id));
}

/** Type ids referenced by system-static.csv — the actual static spawns. */
async function readStaticTypeIds(): Promise<Set<number>> {
  const path = join(DATA_DIR, 'system-static.csv');
  const ids = new Set<number>();
  if (!(await fileExists(path))) return ids;
  const text = await readFile(path, 'utf-8');
  const records = parseCsv(text, {
    columns: true,
    delimiter: ';',
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];
  for (const r of records) {
    const typeId = Number(r.typeID ?? r.type_id ?? r.typeId);
    if (Number.isFinite(typeId)) ids.add(typeId);
  }
  return ids;
}

/**
 * Build a WH-code → typeId map from `(code, typeId)` pairs. The SDE ships duplicate
 * `Wormhole <CODE>` types in group 988 (e.g. two "Wormhole J244", ids 30667 & 73748,
 * dogma-identical and both unpublished — ESI won't disambiguate them either). The
 * vendored catalog/override CSVs key on the code, so a collision MUST resolve to the
 * same typeId the statics use: otherwise the routing/override binds to an id no
 * `universe_system_static` row references and the static silently drops from the UI.
 * Prefer the id present in system-static.csv; warn only if both collide there.
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

/** Returns the set of ingested type ids and the group-988 wormhole-code pairs. */
async function ingestTypes(zip: AdmZip): Promise<{
  typeIds: Set<number>;
  wormholeCodeEntries: { code: string; typeId: number }[];
}> {
  const data = readYaml(zip, 'types.yaml');
  const typeIds = new Set<number>();
  const wormholeCodeEntries: { code: string; typeId: number }[] = [];
  const rows = Object.entries(data).map(([id, t]) => {
    const numId = Number(id);
    typeIds.add(numId);
    const name = en(t.name as Loc) ?? '';
    if (t.groupID === WORMHOLE_GROUP_ID) {
      const code = name.split(' ').pop();
      if (code) wormholeCodeEntries.push({ code, typeId: numId });
    }
    return {
      id: numId,
      groupId: t.groupID as number,
      name,
      description: en(t.description as Loc),
      mass: num(t.mass),
      volume: num(t.volume),
      capacity: num(t.capacity),
      radius: num(t.radius),
      packagedVolume: num(t.packagedVolume),
      portionSize: num(t.portionSize),
      marketGroupId: num(t.marketGroupID),
      graphicId: num(t.graphicID),
      published: bool(t.published),
    };
  });
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
  return { typeIds, wormholeCodeEntries };
}

async function ingestTypeAttributes(zip: AdmZip, typeIds: Set<number>, attrIds: Set<number>) {
  const data = readYaml(zip, 'typeDogma.yaml');
  const rows: { typeId: number; attributeId: number; value: number | null }[] = [];
  for (const [id, entry] of Object.entries(data)) {
    const typeId = Number(id);
    if (!typeIds.has(typeId)) continue;
    const attrs = (entry.dogmaAttributes as { attributeID: number; value: number }[]) ?? [];
    for (const a of attrs) {
      if (!attrIds.has(a.attributeID)) continue;
      rows.push({ typeId, attributeId: a.attributeID, value: num(a.value) });
    }
  }
  for (const c of chunk(rows)) {
    await db
      .insert(universeTypeAttribute)
      .values(c)
      .onConflictDoUpdate({
        target: [universeTypeAttribute.typeId, universeTypeAttribute.attributeId],
        set: excluded(universeTypeAttribute, ['value']),
      });
  }
  return rows.length;
}

async function ingestRegions(zip: AdmZip) {
  const data = readYaml(zip, 'mapRegions.yaml');
  const rows = Object.entries(data).map(([id, r]) => ({
    id: Number(id),
    name: en(r.name as Loc) ?? String(id),
    description: en(r.description as Loc),
  }));
  for (const c of chunk(rows)) {
    await db
      .insert(universeRegion)
      .values(c)
      .onConflictDoUpdate({
        target: universeRegion.id,
        set: excluded(universeRegion, ['name', 'description']),
      });
  }
  return rows.length;
}

/** Returns a constellation id → wormholeClassID map for security derivation. */
async function ingestConstellations(zip: AdmZip): Promise<Map<number, number | null>> {
  const data = readYaml(zip, 'mapConstellations.yaml');
  const whClass = new Map<number, number | null>();
  const rows = Object.entries(data).map(([id, c]) => {
    const pos = (c.position as Record<string, number>) ?? {};
    whClass.set(Number(id), (c.wormholeClassID as number) ?? null);
    return {
      id: Number(id),
      regionId: c.regionID as number,
      name: en(c.name as Loc) ?? String(id),
      x: num(pos.x),
      y: num(pos.y),
      z: num(pos.z),
    };
  });
  for (const c of chunk(rows)) {
    await db
      .insert(universeConstellation)
      .values(c)
      .onConflictDoUpdate({
        target: universeConstellation.id,
        set: excluded(universeConstellation, ['regionId', 'name', 'x', 'y', 'z']),
      });
  }
  return whClass;
}

/** Returns the set of ingested system ids (for stargate-edge filtering). */
async function ingestSystems(
  zip: AdmZip,
  whClassByConstellation: Map<number, number | null>,
): Promise<Set<number>> {
  const data = readYaml(zip, 'mapSolarSystems.yaml');
  const systemIds = new Set<number>();
  const rows = Object.entries(data).map(([id, s]) => {
    const sysId = Number(id);
    systemIds.add(sysId);
    const pos = (s.position as Record<string, number>) ?? {};
    const securityStatus = num(s.securityStatus);
    const regionId = s.regionID as number;
    const constellationId = s.constellationID as number;
    return {
      id: sysId,
      constellationId,
      name: en(s.name as Loc) ?? String(id),
      // Drifter systems share one constellation post-2025, so their class can't
      // be derived from the constellation — pin C14–C18 by system id.
      security:
        drifterClassLabel(sysId) ??
        deriveSecurityLabel({
          regionId,
          wormholeClassId: whClassByConstellation.get(constellationId) ?? null,
          securityStatus,
        }),
      trueSec: securityStatus == null ? null : roundSecurity(securityStatus),
      securityStatus,
      securityClass: en(s.securityClass as Loc),
      // SDE has no wormhole effect; layer it in from the vendored assignment map.
      effect: SYSTEM_EFFECT_BY_ID[sysId] ?? null,
      x: num(pos.x),
      y: num(pos.y),
      z: num(pos.z),
    };
  });
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
  return systemIds;
}

async function ingestStargateEdges(zip: AdmZip, systemIds: Set<number>) {
  const data = readYaml(zip, 'mapStargates.yaml');
  const seen = new Set<string>();
  const rows: { fromSystemId: number; toSystemId: number }[] = [];
  for (const gate of Object.values(data)) {
    const from = gate.solarSystemID as number;
    const dest = gate.destination as { solarSystemID: number } | undefined;
    const to = dest?.solarSystemID;
    if (to == null) continue;
    if (!systemIds.has(from) || !systemIds.has(to)) continue;
    const key = `${from}-${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ fromSystemId: from, toSystemId: to });
  }
  for (const c of chunk(rows)) {
    await db.insert(universeStargateEdge).values(c).onConflictDoNothing();
  }
  return rows.length;
}

/** Vendored community CSV: `systemID;typeID` rows (WH statics, not in the SDE). */
async function ingestSystemStatics(systemIds: Set<number>, typeIds: Set<number>) {
  const path = join(DATA_DIR, 'system-static.csv');
  if (!(await fileExists(path))) {
    console.warn(`  system-static.csv not found at ${path} — skipping WH statics.`);
    return 0;
  }
  const text = await readFile(path, 'utf-8');
  const records = parseCsv(text, {
    columns: true,
    delimiter: ';',
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];
  const seen = new Set<string>();
  const rows: { systemId: number; typeId: number }[] = [];
  for (const r of records) {
    const systemId = Number(r.systemID ?? r.system_id ?? r.systemId);
    const typeId = Number(r.typeID ?? r.type_id ?? r.typeId);
    if (!Number.isFinite(systemId) || !Number.isFinite(typeId)) continue;
    if (!systemIds.has(systemId) || !typeIds.has(typeId)) continue;
    const key = `${systemId}-${typeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ systemId, typeId });
  }
  for (const c of chunk(rows)) {
    await db.insert(universeSystemStatic).values(c).onConflictDoNothing();
  }
  return rows.length;
}

/** Vendored `Id;Name;scanWormholeStrength` CSV → attr-3974 overrides. */
async function ingestTypeOverrides(wormholeCodeToTypeId: Map<string, number>) {
  const path = join(DATA_DIR, 'wormhole-overrides.csv');
  if (!(await fileExists(path))) {
    console.warn(`  wormhole-overrides.csv not found at ${path} — skipping overrides.`);
    return 0;
  }
  const text = await readFile(path, 'utf-8');
  const records = parseCsv(text, {
    columns: true,
    delimiter: ';',
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];
  const rows: { typeId: number; attrId: number; value: number; reason: string }[] = [];
  for (const r of records) {
    const raw = r.scanWormholeStrength;
    if (raw == null || raw === '') continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const code = r.Name?.toUpperCase();
    const typeId = code ? wormholeCodeToTypeId.get(code) : undefined;
    if (typeId == null) continue;
    rows.push({ typeId, attrId: DOGMA_ATTR_SCAN_WORMHOLE_STRENGTH, value, reason: OVERRIDE_REASON });
  }
  // Reseed authoritatively so a re-run after a code→typeId remap drops overrides
  // left on a now-unused duplicate type id.
  await db.delete(universeTypeOverride).where(eq(universeTypeOverride.reason, OVERRIDE_REASON));
  for (const c of chunk(rows)) {
    await db
      .insert(universeTypeOverride)
      .values(c)
      .onConflictDoUpdate({
        target: [universeTypeOverride.typeId, universeTypeOverride.attrId],
        set: { value: sql.raw('excluded."value"'), reason: sql.raw('excluded."reason"') },
      });
  }
  return rows.length;
}

/**
 * Vendored `code;sourceClasses;targetClass;targetSystem` CSV → the
 * `universe_wormhole` routing catalog. Class labels are absent from the SDE;
 * mass/lifetime stay dogma-sourced. `sourceClasses` is a `|`-joined set (a hole
 * can spawn in several classes, e.g. `S199` = `L|0.0`); an empty cell becomes
 * null (source unspecified — K162 and the Drifter/shattered-access holes).
 * `targetSystem` names the fixed destination for holes that always exit to one
 * system (J377 → Turnur); resolved to an id against `universe_system`.
 */
async function ingestWormholeCatalog(wormholeCodeToTypeId: Map<string, number>) {
  const path = join(DATA_DIR, 'wormhole-classes.csv');
  if (!(await fileExists(path))) {
    console.warn(`  wormhole-classes.csv not found at ${path} — skipping WH catalog.`);
    return 0;
  }
  const text = await readFile(path, 'utf-8');
  const records = parseCsv(text, {
    columns: true,
    delimiter: ';',
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  // Only fixed-destination holes carry a targetSystem name; resolve it against
  // universe_system so the FK is guaranteed valid.
  const systemNameToId = new Map<string, number>();
  if (records.some((r) => r.targetSystem)) {
    const systemRows = await db
      .select({ id: universeSystem.id, name: universeSystem.name })
      .from(universeSystem);
    for (const s of systemRows) systemNameToId.set(s.name, s.id);
  }

  const rows: {
    typeId: number;
    name: string;
    sourceClasses: string[] | null;
    targetClass: string | null;
    targetSystemId: number | null;
  }[] = [];
  for (const r of records) {
    const code = r.code?.toUpperCase();
    if (!code) continue;
    const typeId = wormholeCodeToTypeId.get(code);
    if (typeId == null) continue;
    let targetSystemId: number | null = null;
    if (r.targetSystem) {
      const id = systemNameToId.get(r.targetSystem);
      if (id == null) {
        throw new Error(
          `wormhole-classes.csv: ${code} targetSystem "${r.targetSystem}" not found in universe_system`,
        );
      }
      targetSystemId = id;
    }
    rows.push({
      typeId,
      name: code,
      sourceClasses: r.sourceClasses ? r.sourceClasses.split('|') : null,
      targetClass: r.targetClass ? r.targetClass : null,
      targetSystemId,
    });
  }
  // Reseed authoritatively (table is fully derived from this CSV) so a re-run after
  // a code→typeId remap drops catalog rows left on a now-unused duplicate type id.
  await db.delete(universeWormhole);
  for (const c of chunk(rows)) {
    await db
      .insert(universeWormhole)
      .values(c)
      .onConflictDoUpdate({
        target: universeWormhole.typeId,
        set: excluded(universeWormhole, [
          'name',
          'sourceClasses',
          'targetClass',
          'targetSystemId',
        ]),
      });
  }
  return rows.length;
}

export interface IngestResult {
  build: number;
  counts: Record<string, number>;
}

/** Records a successful full ingest onto the `ap_sde_state` singleton row. */
async function recordSdeIngestSuccess(build: number, releaseDate: string) {
  await db
    .insert(apSdeState)
    .values({
      id: 1,
      currentBuild: build,
      currentReleaseDate: releaseDate,
      refreshedAt: new Date(),
      failedAt: null,
      failureReason: null,
      consecutiveFailures: 0,
    })
    .onConflictDoUpdate({
      target: apSdeState.id,
      set: {
        currentBuild: build,
        currentReleaseDate: releaseDate,
        refreshedAt: new Date(),
        failedAt: null,
        failureReason: null,
        consecutiveFailures: 0,
      },
    });
}

/**
 * Re-runnable ingest of only the vendored CSV files (system statics,
 * attr-3974 overrides, WH catalog). Derives the needed ID sets from the DB
 * rather than from an SDE zip, so it can run independently of sde:bootstrap.
 */
export async function runCsvIngest(): Promise<IngestResult> {
  const systemRows = await db.select({ id: universeSystem.id }).from(universeSystem);
  const systemIds = new Set(systemRows.map((r) => r.id));

  const typeRows = await db
    .select({ id: universeType.id, groupId: universeType.groupId, name: universeType.name })
    .from(universeType);
  const typeIds = new Set(typeRows.map((r) => r.id));
  const wormholeCodeEntries: { code: string; typeId: number }[] = [];
  for (const r of typeRows) {
    if (r.groupId === WORMHOLE_GROUP_ID) {
      const code = r.name?.split(' ').pop();
      if (code) wormholeCodeEntries.push({ code, typeId: r.id });
    }
  }
  const wormholeCodeToTypeId = buildWormholeCodeToTypeId(
    wormholeCodeEntries,
    await readStaticTypeIds(),
  );

  const counts: Record<string, number> = {};
  console.log('Ingesting vendored CSVs (system statics, overrides, wormhole catalog) ...');
  counts.systemStatics = await ingestSystemStatics(systemIds, typeIds);
  counts.typeOverrides = await ingestTypeOverrides(wormholeCodeToTypeId);
  counts.wormholes = await ingestWormholeCatalog(wormholeCodeToTypeId);

  return { build: SDE_BUILD, counts };
}

/**
 * One-shot, re-runnable ingest of the pinned SDE build into every `universe_*`
 * table. Downloads the zip if absent, then upserts in FK-safe order. Vendored
 * CSVs seed WH statics and the attr-3974 overrides.
 */
export async function runIngest(): Promise<IngestResult> {
  const zipPath = await ensureSdeZip();
  const zip = new AdmZip(zipPath);
  const counts: Record<string, number> = {};

  console.log('Ingesting categories, groups, dogma attributes ...');
  counts.categories = await ingestCategories(zip);
  counts.groups = await ingestGroups(zip);
  const attrIds = await ingestDogmaAttributes(zip);
  counts.dogmaAttributes = attrIds.size;

  console.log('Ingesting types + type attributes ...');
  const { typeIds, wormholeCodeEntries } = await ingestTypes(zip);
  counts.types = typeIds.size;
  counts.typeAttributes = await ingestTypeAttributes(zip, typeIds, attrIds);
  const wormholeCodeToTypeId = buildWormholeCodeToTypeId(
    wormholeCodeEntries,
    await readStaticTypeIds(),
  );

  console.log('Ingesting regions, constellations, systems ...');
  counts.regions = await ingestRegions(zip);
  const whClass = await ingestConstellations(zip);
  counts.constellations = whClass.size;
  const systemIds = await ingestSystems(zip, whClass);
  counts.systems = systemIds.size;

  console.log('Ingesting stargate edges ...');
  counts.stargateEdges = await ingestStargateEdges(zip, systemIds);

  console.log('Ingesting vendored CSVs (system statics, overrides) ...');
  counts.systemStatics = await ingestSystemStatics(systemIds, typeIds);
  counts.typeOverrides = await ingestTypeOverrides(wormholeCodeToTypeId);
  counts.wormholes = await ingestWormholeCatalog(wormholeCodeToTypeId);

  console.log('Computing trade-hub proximity ...');
  counts.hubProximity = await computeHubProximity();

  await recordSdeIngestSuccess(SDE_BUILD, SDE_RELEASE_DATE);

  return { build: SDE_BUILD, counts };
}
