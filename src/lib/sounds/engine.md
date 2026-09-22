## engine.ts

**Purpose:** The single owner of audio playback — volume, mute, the browser autoplay unlock, per-map leader election and per-event coalescing.
**File:** `src/lib/sounds/engine.ts`

Event sources are renderless bridge components that call `play`; nothing else in the app touches Web Audio. The playback backend and the leader election are injected, so unit tests run against fakes.

---

### SOUND_COALESCE_MS
`2000`. Leading-edge window: the first cue of a kind plays, repeats of that same event inside the window are dropped.

### SOUND_LEADER_LOCK_PREFIX
`'aperture:sound-leader:'` — the Web Locks name a per-map leader holds is this prefix plus the map id.

---

### SoundBackend (interface)
The playback surface the engine drives.
- `isUnlocked(): boolean` — whether the browser currently permits playback.
- `unlock(): Promise<boolean>` — attempt to obtain permission; resolves with the resulting state.
- `has(soundId: SoundId): boolean` — whether a buffer for this id can be produced right now, without waiting.
- `load(soundId: SoundId): Promise<boolean>` — bring this id's buffers in; resolves false when it cannot be produced.
- `play(soundId: SoundId, gain: number, variant: SoundVariant): void` — play at 0..1 gain; never throws.

### SoundLeaderElection (interface)
- `claim(key: string, onChange: (isLeader: boolean) => void): () => void` — claim leadership for `key`; `onChange` reports the current standing and every later change. The returned fn stands down.

### SoundStatus (type)
`{ unlocked: boolean; muted: boolean }`. Reference-stable between changes, so it can back `useSyncExternalStore` directly.

### SoundEngineDeps (type)
`{ backend, election?, now?, bindGestures? }`. A `null` (or omitted) `election` makes every tab a leader. `bindGestures` defaults to on.

---

### createSoundEngine(deps: SoundEngineDeps): SoundEngine
Builds an engine. Unless `bindGestures` is `false`, it binds `unlock()` to the first `pointerdown` / `keydown` captured on the document, and it subscribes to the mute store so a change from any surface is reflected immediately. `dispose()` stands down from the current map lock, removes those listeners and drops all subscribers.

**The engine's methods:**

- `setPrefs(prefs: SoundPrefs)` — the account's preferences. Until it is called, the defaults apply, which means silence. `AccountSettingsDialog` is the single writer, so the engine always holds the live optimistic blob rather than a stale server copy pushed by a second surface. It also prefetches the files behind every enabled event's sound, so a file-backed cue is ready before it fires rather than falling back to a chime the first time.
- `setMapId(mapId: string | null)` — the map this tab is showing. Releases the previous map's lock and claims the new one. With an election present and no map id, the tab is not a leader.
- `play(event, opts?: { variant? })` — plays the event's cue. Silent, with no error and no toast, unless all of these hold: the master switch is on, that event is enabled, the device is not muted, the browser has unlocked audio, this tab holds the map's lock, and no cue of the same event played within `SOUND_COALESCE_MS`. The coalesce window starts only on a cue that actually played, so a cue a gate blocked does not suppress the next one. The sound id is the event's configured one when the backend has it, and that event's default chime otherwise — so a pref naming a sound missing on this device still makes a noise. Falling back also kicks off a load of the wanted sound, so a prefetch the engine missed heals by the next cue; a file that has already failed is not refetched. `variant` defaults to `'plain'`.
- `preview(soundId)` — auditions a sound's `'plain'` line, bypassing the master switch, mute, leadership and coalescing, at the configured volume. A sound the backend does not yet hold is loaded first and played once it arrives; an id it cannot produce at all is dropped. When audio is still locked it unlocks first and plays once granted, so the preview click is itself the unlocking gesture.
- `unlock()` — asks the browser for playback permission; must be called from a user gesture.
- `setMuted(muted)` / `toggleMute()` — writes the device mute through the mute store.
- `getSnapshot()` / `getServerSnapshot()` / `subscribe(listener)` — the `useSyncExternalStore` triple over `SoundStatus`.

---

### createWebAudioBackend(): SoundBackend
Web Audio playback. Creates one `AudioContext` and one master `GainNode` lazily on first use, and memoizes one `AudioBuffer` per clip: a chime keyed by its sound id and synthesized from the catalog on demand, a voice line keyed by its file path and decoded after a `fetch`, an imported sound keyed by its `custom:` id. A chime always reports `has`; a voice sound reports it only once every file the catalog names for that id is decoded, so a partly-loaded pack cues the chime rather than a silent gap. A failed path is remembered and never refetched. Reports unlocked only while the context state is `running`. Every failure path — no `AudioContext`, a refused `resume()`, a fetch or decode that throws, a source that will not start — is silent.

### createWebLocksElection(): SoundLeaderElection | null
Leader election over the Web Locks API. The lock is held for the tab's lifetime, so the next waiter takes over the moment the holder goes. Returns `null` where Web Locks is unavailable, which makes the engine play unconditionally.

---

### getSoundEngine(): SoundEngine
The app-wide engine, created on first use with `createWebAudioBackend()` and `createWebLocksElection()`.
