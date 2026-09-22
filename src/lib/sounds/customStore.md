## customStore.ts

**Purpose:** The sound files a user imported on this device — held in IndexedDB, validated on import, and offered to the picker and the engine.
**File:** `src/lib/sounds/customStore.ts`

Imported audio never reaches the server: the account pref carries only the `custom:<uuid>` id, so the same account on another device falls back to the event's default chime. The IndexedDB access and the decode step are injected, so unit tests run against an in-memory double without a fake IndexedDB or Web Audio.

---

### CUSTOM_SOUND_MAX_BYTES
The largest file accepted on import, in bytes.

### CUSTOM_SOUND_MAX_MS
The longest decoded clip accepted on import, in milliseconds.

---

### CustomSound (type)
`{ id: CustomSoundId; label: string; mime: string; durationMs: number }` — what the settings dialog and the picker list. `label` is the file name without its extension, capped in length.

### StoredCustomSound (type)
`CustomSound & { blob: Blob }` — the row as it sits in the db.

### CustomSoundDb (interface)
The persistence surface the store drives: `getAll()`, `get(id)`, `put(record)`, `delete(id)`, all promise-returning.

### CustomSoundAddResult (type)
`{ ok: true; sound: CustomSound } | { ok: false; error: string }`; `error` is written for a toast.

### CustomSoundDeps (type)
`{ db: CustomSoundDb; decode: (bytes: ArrayBuffer) => Promise<number | null>; newId?: () => string }`. `decode` resolves the clip length in ms, or `null` when the bytes are not decodable audio. `newId` defaults to `crypto.randomUUID`.

---

### createCustomSoundStore(deps: CustomSoundDeps): CustomSoundStore
Builds a store. Its methods:

- `list()` — this device's sounds, label-sorted. Reference-stable between changes, so it backs `useSyncExternalStore` directly. It returns empty until the first read of the db lands, and the resulting notification is what fills it.
- `add(file)` — rejects a file over `CUSTOM_SOUND_MAX_BYTES` before reading it, then decodes: bytes that are not audio, and a clip over `CUSTOM_SOUND_MAX_MS`, are both rejected with nothing stored. On success the row is written under a fresh `custom:<uuid>` id, which is the form `soundPrefsSchema` accepts at the persistence boundary.
- `remove(id)` — drops the row and notifies.
- `bytesFor(soundId)` — the raw bytes behind an id, or `null` when this device does not hold it.
- `subscribe(listener)` — returns an unsubscribe fn; the first subscriber also starts the initial db read.

A db that throws — a browser with storage blocked — yields an empty list rather than an error, except on `add`, which reports the failure so the dialog can toast it.

---

### createIndexedDbCustomSoundDb(): CustomSoundDb
IndexedDB persistence: database `aperture-sounds`, one object store keyed by the `custom:` id, opened lazily on first access.

---

### getCustomSoundStore(): CustomSoundStore
The device-wide store, created on first use over IndexedDB, decoding through an `OfflineAudioContext` so validation never touches the playback context or the browser's autoplay state.

---

### useCustomSounds(): readonly CustomSound[]
This device's imported sounds, re-rendering the caller as they change.
