import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ReadableStream } from 'node:stream/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureSdeZip } from '@/lib/sde/ingest';

/** A build number CCP will never publish, so the test can't collide with a real cached zip. */
const TEST_BUILD = 999000001;
const CACHE_DIR = join(process.cwd(), '.sde-cache');
const ZIP_PATH = join(CACHE_DIR, `sde-${TEST_BUILD}-yaml.zip`);

/** Above `MIN_SDE_ZIP_BYTES`, so a complete download is accepted as plausible. */
const FULL_BODY = Buffer.alloc(1_200_000, 7);
const SHORT_BODY = Buffer.alloc(4096, 7);

function webBody(chunks: Buffer[], errorAfter?: Error): ReadableStream {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(new Uint8Array(c));
      if (errorAfter) controller.error(errorAfter);
      else controller.close();
    },
  });
}

function response(body: ReadableStream, contentLength?: number) {
  return {
    ok: true,
    status: 200,
    body,
    headers: new Headers(contentLength == null ? {} : { 'content-length': String(contentLength) }),
  };
}

/** Every cache entry for the test build — the zip itself and any `.part` left behind. */
async function cacheEntries(): Promise<string[]> {
  const entries = await readdir(CACHE_DIR).catch(() => [] as string[]);
  return entries.filter((e) => e.startsWith(`sde-${TEST_BUILD}-yaml.zip`));
}

async function clearCacheEntries() {
  for (const entry of await cacheEntries()) await rm(join(CACHE_DIR, entry), { force: true });
}

describe('ensureSdeZip', () => {
  beforeEach(async () => {
    await mkdir(CACHE_DIR, { recursive: true });
    await clearCacheEntries();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await clearCacheEntries();
  });

  it('leaves no cache entry behind when the download is interrupted mid-stream', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(webBody([SHORT_BODY], new Error('connection reset')))),
    );

    await expect(ensureSdeZip(TEST_BUILD)).rejects.toThrow();
    expect(await cacheEntries()).toEqual([]);
  });

  it('rejects a body shorter than its declared content-length and caches nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(webBody([SHORT_BODY]), FULL_BODY.byteLength)),
    );

    await expect(ensureSdeZip(TEST_BUILD)).rejects.toThrow(/truncated/);
    expect(await cacheEntries()).toEqual([]);
  });

  it('rejects an implausibly small complete body and caches nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(webBody([SHORT_BODY]), SHORT_BODY.byteLength)),
    );

    await expect(ensureSdeZip(TEST_BUILD)).rejects.toThrow(/implausibly small/);
    expect(await cacheEntries()).toEqual([]);
  });

  it('caches a complete download and serves the second call from disk', async () => {
    const fetchMock = vi.fn(async () => response(webBody([FULL_BODY]), FULL_BODY.byteLength));
    vi.stubGlobal('fetch', fetchMock);

    expect(await ensureSdeZip(TEST_BUILD)).toBe(ZIP_PATH);
    expect(await ensureSdeZip(TEST_BUILD)).toBe(ZIP_PATH);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await cacheEntries()).toEqual([`sde-${TEST_BUILD}-yaml.zip`]);
    expect((await readFile(ZIP_PATH)).byteLength).toBe(FULL_BODY.byteLength);
  });

  it('discards a truncated cached zip and re-downloads it', async () => {
    await writeFile(ZIP_PATH, SHORT_BODY);
    const fetchMock = vi.fn(async () => response(webBody([FULL_BODY]), FULL_BODY.byteLength));
    vi.stubGlobal('fetch', fetchMock);

    expect(await ensureSdeZip(TEST_BUILD)).toBe(ZIP_PATH);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await readFile(ZIP_PATH)).byteLength).toBe(FULL_BODY.byteLength);
  });
});
