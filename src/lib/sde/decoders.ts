import { z } from 'zod';

/**
 * Zod decoders for the SDE JSONL files `parseSdeArchive` (`./ingest.ts`) reads.
 * CCP reorganizes the SDE periodically; a renamed or dropped key must surface
 * as a decode error naming the file and entry, not an `undefined` cast that
 * silently NOT-NULLs its way into a partially-written ingest.
 */

// A locale value is usually a string. Accept a bare number too as boundary
// tolerance for a numeric-looking name (e.g. a purely-digit constellation or
// region name) arriving unquoted; `en()` (ingest.ts) coerces to string.
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

/** Thrown when an SDE entry fails its Zod schema — format drift, not content. */
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

function decodeJsonlLine<T extends z.ZodType>(
  file: string,
  line: string,
  lineNo: number,
  schema: T,
  onEntry: (id: number, entry: z.infer<T>) => void,
): void {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch (err) {
    throw new SdeFormatError(file, `line ${lineNo}`, err);
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new SdeFormatError(file, `line ${lineNo}`, `expected a JSON object, got ${typeof json}`);
  }
  const raw = json as Record<string, unknown>;
  if (!('_key' in raw)) {
    throw new SdeFormatError(file, `line ${lineNo}`, 'line has no "_key"');
  }
  const id = Number(raw._key);
  if (!Number.isInteger(id)) {
    throw new SdeFormatError(file, `line ${lineNo}`, '"_key" is not an integer id');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new SdeFormatError(file, String(id), parsed.error);
  }
  onEntry(id, parsed.data);
}

/**
 * Decodes a `.jsonl` SDE entry stream one line at a time — `JSON.parse`s the
 * line, reads its `_key` as the record id, `safeParse`s the line against
 * `schema`, and hands `(id, entry)` to `onEntry` before discarding it. No
 * whole-file document tree, intermediate `Map` of validated entries, or
 * whole-entry buffer is ever held; only one decoded line and the unconsumed
 * tail of the current chunk are live at a time. Rejects a line that isn't a
 * JSON object, a line missing `_key`, and a line failing `schema` as a named
 * `SdeFormatError`; a malformed line surfaces as `SdeFormatError` wrapping the
 * underlying `JSON.parse` error. Rejects with the stream's error on a read
 * failure.
 */
export async function decodeJsonlEntries<T extends z.ZodType>(
  file: string,
  stream: NodeJS.ReadableStream,
  schema: T,
  onEntry: (id: number, entry: z.infer<T>) => void,
): Promise<void> {
  let tail = Buffer.alloc(0);
  let lineNo = 0;
  for await (const part of stream) {
    const chunk = tail.length > 0 ? Buffer.concat([tail, part as Buffer]) : (part as Buffer);
    let start = 0;
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] !== 0x0a) continue;
      let end = i;
      if (end > start && chunk[end - 1] === 0x0d) end--; // trailing \r
      lineNo++;
      if (end > start) {
        decodeJsonlLine(file, chunk.subarray(start, end).toString('utf-8'), lineNo, schema, onEntry);
      }
      start = i + 1;
    }
    // Copy rather than subarray: a subarray view would pin the whole backing chunk alive.
    tail = start < chunk.length ? Buffer.from(chunk.subarray(start)) : Buffer.alloc(0);
  }
  lineNo++;
  if (tail.length > 0) {
    let end = tail.length;
    if (tail[end - 1] === 0x0d) end--; // trailing \r
    decodeJsonlLine(file, tail.subarray(0, end).toString('utf-8'), lineNo, schema, onEntry);
  }
}
