import { describe, expect, it, vi } from 'vitest';
import {
  CUSTOM_SOUND_MAX_BYTES,
  CUSTOM_SOUND_MAX_MS,
  createCustomSoundStore,
  type CustomSoundDb,
  type StoredCustomSound,
} from '@/lib/sounds/customStore';
import { isSoundId } from '@/lib/sounds/prefs';

/** In-memory stand-in for the IndexedDB object store. */
function fakeDb(): CustomSoundDb & { rows: Map<string, StoredCustomSound> } {
  const rows = new Map<string, StoredCustomSound>();
  return {
    rows,
    getAll: async () => [...rows.values()],
    get: async (id) => rows.get(id),
    put: async (record) => void rows.set(record.id, record),
    delete: async (id) => void rows.delete(id),
  };
}

let uuidSeq = 0;
function nextUuid(): string {
  uuidSeq += 1;
  return `2f1c9e40-5a3b-4c1d-9e88-${String(uuidSeq).padStart(12, '0')}`;
}

function store(opts: { db?: ReturnType<typeof fakeDb>; durationMs?: number | null } = {}) {
  const db = opts.db ?? fakeDb();
  const decode = vi.fn(async () => (opts.durationMs === undefined ? 900 : opts.durationMs));
  return {
    db,
    decode,
    subject: createCustomSoundStore({ db, decode, newId: nextUuid }),
  };
}

function audioFile(name: string, bytes = 32): File {
  return new File([new Uint8Array(bytes)], name, { type: 'audio/mpeg' });
}

/** A File whose `size` lies, so an oversize import needs no megabyte of memory. */
function oversizeFile(name: string): File {
  const file = audioFile(name);
  Object.defineProperty(file, 'size', { value: CUSTOM_SOUND_MAX_BYTES + 1 });
  return file;
}

describe('custom sound store', () => {
  it('stores an imported file and lists it with a well-formed id', async () => {
    const { subject, db } = store();

    const result = await subject.add(audioFile('Alarm Klaxon.mp3'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sound.label).toBe('Alarm Klaxon');
    expect(result.sound.durationMs).toBe(900);
    // The id lands in `ap_user.sound_prefs`, where the strict schema rejects
    // anything that is not a built-in or a well-formed `custom:<uuid>`.
    expect(isSoundId(result.sound.id)).toBe(true);
    expect(db.rows.has(result.sound.id)).toBe(true);
    expect(subject.list().map((s) => s.label)).toEqual(['Alarm Klaxon']);
  });

  it('notifies subscribers on add and on remove', async () => {
    const { subject } = store();
    const listener = vi.fn();
    subject.subscribe(listener);

    const added = await subject.add(audioFile('Ping.mp3'));
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(listener).toHaveBeenCalled();

    listener.mockClear();
    await subject.remove(added.sound.id);
    expect(listener).toHaveBeenCalled();
    expect(subject.list()).toEqual([]);
  });

  it('rejects an oversize file without decoding or storing it', async () => {
    const { subject, db, decode } = store();

    const result = await subject.add(oversizeFile('Huge.mp3'));

    expect(result.ok).toBe(false);
    expect(decode).not.toHaveBeenCalled();
    expect(db.rows.size).toBe(0);
    expect(subject.list()).toEqual([]);
  });

  it('rejects a file that will not decode as audio', async () => {
    const { subject, db } = store({ durationMs: null });

    const result = await subject.add(audioFile('notes.txt'));

    expect(result.ok).toBe(false);
    expect(db.rows.size).toBe(0);
  });

  it('rejects a clip longer than the cap', async () => {
    const { subject, db } = store({ durationMs: CUSTOM_SOUND_MAX_MS + 1 });

    const result = await subject.add(audioFile('Symphony.mp3'));

    expect(result.ok).toBe(false);
    expect(db.rows.size).toBe(0);
  });

  it('rejects a file the browser will not store', async () => {
    const db = fakeDb();
    db.put = async () => {
      throw new Error('QuotaExceededError');
    };
    const { subject } = store({ db });

    const result = await subject.add(audioFile('Ping.mp3'));

    expect(result.ok).toBe(false);
    expect(subject.list()).toEqual([]);
  });

  it('reports a refusal rather than rejecting when the id cannot be minted', async () => {
    const db = fakeDb();
    // `crypto.randomUUID` throws outside a secure context, e.g. an instance
    // served over plain HTTP on a LAN.
    const subject = createCustomSoundStore({
      db,
      decode: async () => 900,
      newId: () => {
        throw new TypeError('crypto.randomUUID is not a function');
      },
    });

    const result = await subject.add(audioFile('Ping.mp3'));

    expect(result.ok).toBe(false);
    expect(db.rows.size).toBe(0);
  });

  it('hands back the stored bytes for an id it holds and null for one it does not', async () => {
    const { subject } = store();
    const added = await subject.add(new File([new Uint8Array([1, 2, 3, 4])], 'Ping.mp3'));
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    const bytes = await subject.bytesFor(added.sound.id);
    expect(bytes).not.toBeNull();
    expect(bytes?.byteLength).toBe(4);

    await subject.remove(added.sound.id);
    expect(await subject.bytesFor(added.sound.id)).toBeNull();
  });

  it('survives a reload: a fresh store over the same db lists what was imported', async () => {
    const db = fakeDb();
    const first = store({ db });
    const added = await first.subject.add(audioFile('Ping.mp3'));
    expect(added.ok).toBe(true);

    const reloaded = createCustomSoundStore({ db, decode: async () => 900, newId: nextUuid });
    expect(reloaded.list()).toEqual([]);
    const listener = vi.fn();
    reloaded.subscribe(listener);
    await vi.waitFor(() => expect(reloaded.list()).toHaveLength(1));
    expect(reloaded.list()[0]?.label).toBe('Ping');
  });

  it('reads as empty when the browser refuses IndexedDB', async () => {
    const db = fakeDb();
    db.getAll = async () => {
      throw new Error('blocked');
    };
    const { subject } = store({ db });

    subject.subscribe(() => {});
    await vi.waitFor(() => expect(subject.list()).toEqual([]));
  });
});
