'use client';

/**
 * Sound files the user imported on this device. They live in IndexedDB and
 * never reach the server — a self-hosted deployment has no object store, and
 * the account pref only carries the `custom:<uuid>` id, so the same account on
 * another device falls back to the event's default chime.
 *
 * The IndexedDB access and the decode step are injected, so unit tests run
 * against an in-memory double without a fake IndexedDB or Web Audio.
 */

import { useSyncExternalStore } from 'react';

import type { CustomSoundId, SoundId } from './prefs';

/** Largest file accepted on import. */
export const CUSTOM_SOUND_MAX_BYTES = 1_048_576;

/** Longest clip accepted on import, decoded duration. */
export const CUSTOM_SOUND_MAX_MS = 5_000;

const DB_NAME = 'aperture-sounds';
const DB_VERSION = 1;
const STORE_NAME = 'custom';
const MAX_LABEL_CHARS = 40;

/** What the settings dialog and the picker list; the audio itself stays in the db. */
export type CustomSound = {
  id: CustomSoundId;
  label: string;
  mime: string;
  durationMs: number;
};

export type StoredCustomSound = CustomSound & { blob: Blob };

/** The persistence surface the store drives. */
export interface CustomSoundDb {
  getAll(): Promise<StoredCustomSound[]>;
  get(id: string): Promise<StoredCustomSound | undefined>;
  put(record: StoredCustomSound): Promise<void>;
  delete(id: string): Promise<void>;
}

export type CustomSoundAddResult = { ok: true; sound: CustomSound } | { ok: false; error: string };

export interface CustomSoundStore {
  /** This device's imported sounds, label-sorted. Reference-stable between changes. */
  list(): readonly CustomSound[];
  add(file: File): Promise<CustomSoundAddResult>;
  remove(id: CustomSoundId): Promise<void>;
  /** The raw bytes behind an id, or `null` when this device does not hold it. */
  bytesFor(soundId: SoundId): Promise<ArrayBuffer | null>;
  subscribe(listener: () => void): () => void;
}

export type CustomSoundDeps = {
  db: CustomSoundDb;
  /** Clip length in ms, or `null` when the bytes are not decodable audio. */
  decode: (bytes: ArrayBuffer) => Promise<number | null>;
  newId?: () => string;
};

const EMPTY: readonly CustomSound[] = [];

function meta(record: StoredCustomSound): CustomSound {
  return {
    id: record.id,
    label: record.label,
    mime: record.mime,
    durationMs: record.durationMs,
  };
}

function labelFor(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '').trim();
  return stem === '' ? 'Sound' : stem.slice(0, MAX_LABEL_CHARS);
}

export function createCustomSoundStore(deps: CustomSoundDeps): CustomSoundStore {
  const { db, decode } = deps;
  const newId = deps.newId ?? (() => crypto.randomUUID());

  let snapshot: readonly CustomSound[] = EMPTY;
  let hydrating: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  function publish(records: StoredCustomSound[]): void {
    snapshot = records.map(meta).sort((a, b) => a.label.localeCompare(b.label));
    for (const listener of listeners) listener();
  }

  async function refresh(): Promise<void> {
    try {
      publish(await db.getAll());
    } catch {
      // A browser that refuses IndexedDB (private mode, blocked storage) has no
      // imported sounds rather than a broken settings dialog.
    }
  }

  function hydrate(): void {
    hydrating ??= refresh();
  }

  return {
    list(): readonly CustomSound[] {
      hydrate();
      return snapshot;
    },

    async add(file: File): Promise<CustomSoundAddResult> {
      if (file.size > CUSTOM_SOUND_MAX_BYTES) {
        return {
          ok: false,
          error: `Sound files must be under ${Math.round(CUSTOM_SOUND_MAX_BYTES / 1024)} KB.`,
        };
      }

      let durationMs: number | null = null;
      try {
        durationMs = await decode(await file.arrayBuffer());
      } catch {
        durationMs = null;
      }
      if (durationMs == null) {
        return { ok: false, error: `${file.name} could not be read as an audio file.` };
      }
      if (durationMs > CUSTOM_SOUND_MAX_MS) {
        return {
          ok: false,
          error: `Sounds must be shorter than ${CUSTOM_SOUND_MAX_MS / 1000} seconds.`,
        };
      }

      // `crypto.randomUUID` is secure-context-only, so minting the id belongs
      // inside the guard with the write: an instance served over plain HTTP
      // reports the refusal rather than rejecting out of a caller's `await`.
      let record: StoredCustomSound;
      try {
        record = {
          id: `custom:${newId()}`,
          label: labelFor(file.name),
          mime: file.type === '' ? 'application/octet-stream' : file.type,
          durationMs,
          blob: file,
        };
        await db.put(record);
      } catch {
        return { ok: false, error: 'This browser would not store the sound.' };
      }
      await refresh();
      return { ok: true, sound: meta(record) };
    },

    async remove(id: CustomSoundId): Promise<void> {
      try {
        await db.delete(id);
      } catch {
        return;
      }
      await refresh();
    },

    async bytesFor(soundId: SoundId): Promise<ArrayBuffer | null> {
      try {
        const record = await db.get(soundId);
        return record ? await record.blob.arrayBuffer() : null;
      } catch {
        return null;
      }
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      hydrate();
      return () => listeners.delete(listener);
    },
  };
}

/** IndexedDB persistence, one object store keyed by the `custom:` id. */
export function createIndexedDbCustomSoundDb(): CustomSoundDb {
  let opening: Promise<IDBDatabase> | null = null;

  function database(): Promise<IDBDatabase> {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('no indexedDB'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
    });
    return opening;
  }

  async function run<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await database();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const request = fn(tx.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('indexedDB request failed'));
    });
  }

  return {
    getAll: () => run('readonly', (store) => store.getAll() as IDBRequest<StoredCustomSound[]>),
    get: (id) =>
      run('readonly', (store) => store.get(id) as IDBRequest<StoredCustomSound | undefined>),
    put: async (record) => void (await run('readwrite', (store) => store.put(record))),
    delete: async (id) => void (await run('readwrite', (store) => store.delete(id))),
  };
}

/**
 * Decodes just far enough to prove the bytes are audio and measure them. An
 * `OfflineAudioContext` does this without touching the playback context or the
 * browser's autoplay state.
 */
async function decodeDurationMs(bytes: ArrayBuffer): Promise<number | null> {
  if (typeof OfflineAudioContext === 'undefined') return null;
  try {
    const buffer = await new OfflineAudioContext(1, 1, 44_100).decodeAudioData(bytes);
    return Math.round(buffer.duration * 1000);
  } catch {
    return null;
  }
}

let singleton: CustomSoundStore | null = null;

/** The device-wide store, created on first use over IndexedDB. */
export function getCustomSoundStore(): CustomSoundStore {
  singleton ??= createCustomSoundStore({
    db: createIndexedDbCustomSoundDb(),
    decode: decodeDurationMs,
  });
  return singleton;
}

function serverSnapshot(): readonly CustomSound[] {
  return EMPTY;
}

/** This device's imported sounds, re-rendering the caller as they change. */
export function useCustomSounds(): readonly CustomSound[] {
  const store = getCustomSoundStore();
  return useSyncExternalStore(store.subscribe, store.list, serverSnapshot);
}
