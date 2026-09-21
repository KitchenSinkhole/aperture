## catalog.ts

**Purpose:** The built-in chimes, synthesized into an `AudioBuffer` on demand, plus the human-readable labels the settings dialog renders from.
**File:** `src/lib/sounds/catalog.ts`

The chimes are generated with Web Audio rather than shipped as files — no assets and no fetch latency. Sample rendering is pure arithmetic over a `BaseAudioContext`'s buffer, so it runs against any object exposing `sampleRate` and `createBuffer`.

---

### BuiltInSound (type)
`{ id: BuiltInSoundId; label: string; synth: (ctx: BaseAudioContext) => AudioBuffer }`. `synth` renders a mono buffer belonging to `ctx`; every tone carries a short linear attack and an exponential decay, and the summed result is normalised so overlapping tones cannot clip.

### BUILT_IN_SOUNDS
The catalog, in `BUILT_IN_SOUND_IDS` order: `chime-up` ("Chime (rising)", a rising two-tone), `chime-down` ("Chime (falling)", the same pair falling), `tick` ("Tick", one short high blip), `alarm` ("Alarm", a harsher falling square-wave pair).

---

### getBuiltInSound(id: SoundId): BuiltInSound | undefined
The catalog entry for `id`, or `undefined` for a custom or unknown id.

---

### defaultSoundForEvent(event: SoundEvent): SoundId
The chime an event falls back to when its chosen sound is unavailable on this device, read from `DEFAULT_SOUND_PREFS`.

---

### SOUND_EVENT_LABELS
`Record<SoundEvent, { label: string; description: string }>` — the title and one-line explanation for each event's row in the account settings dialog.
