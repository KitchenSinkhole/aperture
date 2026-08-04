import { z } from 'zod';

/**
 * Zod decoders for the SDE YAML files `parseSdeArchive` (`./ingest.ts`) reads.
 * CCP reorganizes the SDE periodically; a renamed or dropped key must surface
 * as a decode error naming the file and entry, not an `undefined` cast that
 * silently NOT-NULLs its way into a partially-written ingest.
 */

// A locale value is usually a string, but the SDE occasionally ships a
// numeric-looking name (e.g. a purely-digit constellation/region name) that
// YAML parses as a number rather than a string — accept both and let `en()`
// (ingest.ts) coerce to string.
const localizedValueSchema = z.union([z.string(), z.number()]);
const localizedSchema = z.union([localizedValueSchema, z.record(z.string(), localizedValueSchema)]);

export const sdeCategorySchema = z
  .object({
    name: localizedSchema,
    published: z.boolean().optional(),
  })
  .loose();

export const sdeGroupSchema = z
  .object({
    categoryID: z.number().int(),
    name: localizedSchema,
    published: z.boolean().optional(),
  })
  .loose();

export const sdeDogmaAttributeSchema = z
  .object({
    name: z.string().optional(),
    displayName: localizedSchema.optional(),
    description: localizedSchema.optional(),
    published: z.boolean().optional(),
    stackable: z.boolean().optional(),
    highIsGood: z.boolean().optional(),
    defaultValue: z.number().optional(),
    iconID: z.number().optional(),
    unitID: z.number().optional(),
  })
  .loose();

export const sdeTypeSchema = z
  .object({
    groupID: z.number().int(),
    name: localizedSchema,
    description: localizedSchema.optional(),
    mass: z.number().optional(),
    volume: z.number().optional(),
    capacity: z.number().optional(),
    radius: z.number().optional(),
    packagedVolume: z.number().optional(),
    portionSize: z.number().optional(),
    marketGroupID: z.number().optional(),
    graphicID: z.number().optional(),
    published: z.boolean().optional(),
  })
  .loose();

export const sdeTypeDogmaSchema = z
  .object({
    dogmaAttributes: z
      .array(z.object({ attributeID: z.number().int(), value: z.number() }).loose())
      .optional(),
  })
  .loose();

export const sdeRegionSchema = z
  .object({
    name: localizedSchema,
    description: localizedSchema.optional(),
  })
  .loose();

export const sdeConstellationSchema = z
  .object({
    regionID: z.number().int(),
    name: localizedSchema,
    wormholeClassID: z.number().optional(),
    position: z.object({ x: z.number(), y: z.number(), z: z.number() }).loose().optional(),
  })
  .loose();

export const sdeSolarSystemSchema = z
  .object({
    constellationID: z.number().int(),
    regionID: z.number().int(),
    name: localizedSchema,
    securityStatus: z.number(),
    securityClass: localizedSchema.optional(),
    position: z.object({ x: z.number(), y: z.number(), z: z.number() }).loose().optional(),
  })
  .loose();

export const sdeStargateSchema = z
  .object({
    solarSystemID: z.number().int(),
    destination: z.object({ solarSystemID: z.number().int() }).loose().optional(),
  })
  .loose();

/** One line of `<SDE_BASE>/latest.jsonl` — the build-freshness manifest `sde-refresh` polls. */
export const sdeLatestManifestSchema = z
  .object({
    _key: z.string(),
    buildNumber: z.number().int(),
    releaseDate: z.string(),
  })
  .loose();

/** Thrown when an SDE YAML entry fails its Zod schema — format drift, not content. */
export class SdeFormatError extends Error {
  constructor(
    public readonly file: string,
    public readonly entryKey: string,
    public readonly cause: unknown,
  ) {
    super(
      `SDE file ${file} entry ${entryKey} failed validation: ${
        cause instanceof z.ZodError ? cause.issues.map((i) => i.path.join('.')).join(', ') : cause
      }`,
    );
    this.name = 'SdeFormatError';
  }
}

/**
 * Decodes every entry of a `{ id: entry }`-shaped SDE YAML map through `schema`,
 * `safeParse`-ing so a decode failure raises a named `SdeFormatError` rather than
 * throwing a bare `ZodError` with no file/entry context. Rejects a non-object
 * top level outright — a list-shaped file is exactly the layout drift to catch.
 */
export function decodeEntries<T extends z.ZodType>(
  file: string,
  data: unknown,
  schema: T,
): Map<number, z.infer<T>> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new SdeFormatError(file, '<root>', `expected an object keyed by id, got ${typeof data}`);
  }
  const out = new Map<number, z.infer<T>>();
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const id = Number(key);
    if (!Number.isInteger(id)) {
      throw new SdeFormatError(file, key, `key is not an integer id`);
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new SdeFormatError(file, key, parsed.error);
    }
    out.set(id, parsed.data);
  }
  return out;
}
