## mutePrefs.ts

**Purpose:** Client-only localStorage read/write for the device-level sound mute, exposed as a subscribable store so the engine and the toolbar button stay in step.
**File:** `src/lib/sounds/mutePrefs.ts`

Mute is per device, not per account: it survives a reload and applies to every tab on the device.

---

### SOUND_MUTED_KEY
The localStorage key (`'aperture:sounds:muted'`) holding `'1'` or `'0'`.

---

### readSoundMuted(): boolean
Whether sounds are muted on this device. Reads storage on first call and returns a cached value afterwards (suitable as a `useSyncExternalStore` snapshot); the cache is refreshed by `writeSoundMuted` and by another tab's write. A storage error reads as unmuted.

### getServerSoundMuted(): boolean
Server snapshot for `useSyncExternalStore` — always `false`.

### writeSoundMuted(muted: boolean): void
Persists the flag (swallowing storage errors), updates the cache, and notifies all subscribers.

### subscribeSoundMuted(listener: () => void): () => void
Registers a change listener; returns an unsubscribe function. While at least one listener is registered the store listens for the `storage` event (including a whole-storage clear), so a mute written in another tab invalidates the cache and notifies here without a reload; listeners fire only when the value actually changes. The last unsubscribe detaches the listener.
