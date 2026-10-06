## catalog.ts

**Purpose:** Everything the app can play out of the box — the synthesized chimes and the recorded voice packs — plus the human-readable labels the settings dialog renders from.
**File:** `src/lib/sounds/catalog.ts`

The chimes are generated with Web Audio rather than shipped as files, so they cost no assets and no fetch latency. Sample rendering is pure arithmetic over a `BaseAudioContext`'s buffer, so it runs against any object exposing `sampleRate` and `createBuffer`. The voice packs are `.mp3` files served from `public/sounds/voice/`, named and fetched by the catalog and decoded by the engine's backend.

---

### ChimeSound (type)
`{ kind: 'chime'; id: ChimeSoundId; label: string; synth: (ctx: BaseAudioContext) => AudioBuffer }`. `synth` renders a mono buffer belonging to `ctx`; every tone carries a short linear attack and an exponential decay, and the summed result is normalised so overlapping tones cannot clip.

### VoiceSound (type)
`{ kind: 'voice'; id: VoiceSoundId; label: string; pack: VoicePackId; event: SoundEvent; files: Record<SoundVariant, string> }`. `label` is the pack's name, since a pack contributes exactly one option to any one event's picker. `files` holds a public path per variant; only `watchedJump` has three distinct lines, and every other event points all three variants at its single file.

### BuiltInSound (type)
`ChimeSound | VoiceSound`, discriminated by `kind`.

### CHIME_SOUNDS
The chimes in `CHIME_SOUND_IDS` order:
- `chime-up` ("Chime (rising)"): a rising two-tone
- `chime-down` ("Chime (falling)"): the same pair falling
- `arpeggio` ("Arpeggio"): a rising three-note major triad
- `tick` ("Tick"): one short high blip
- `tick-loud` ("Tick (loud)"): a louder, fuller double tick at the same pitch
- `ping` ("Ping"): a single high note with a long ring
- `bell` ("Bell"): a low bell with inharmonic partials and the longest tail
- `beeps` ("Beeps"): three quick square-wave beeps
- `alarm` ("Alarm"): a harsher falling square-wave pair
- `klaxon` ("Klaxon"): a two-note square-wave siren, alternating twice

Every event's picker offers all of them.

### BUILT_IN_SOUNDS
`CHIME_SOUNDS` followed by one `VoiceSound` per pack per event, in `BUILT_IN_SOUND_IDS` order.

---

### getBuiltInSound(id: SoundId): BuiltInSound | undefined
The catalog entry for `id`, or `undefined` for a custom or unknown id.

---

### voiceSoundsForEvent(event: SoundEvent): readonly VoiceSound[]
The one voice entry each pack contributes to `event` — what the picker lists under its "Voice packs" group.

---

### soundFilesFor(id: SoundId): readonly string[]
Every distinct file `id` needs, deduplicated; empty for a chime, a custom or an unknown id. The backend loads exactly this set before reporting `has(id)`.

---

### defaultSoundForEvent(event: SoundEvent): SoundId
The chime an event falls back to when its chosen sound is unavailable on this device, read from `DEFAULT_SOUND_PREFS`.

---

### SOUND_EVENT_LABELS
`Record<SoundEvent, { label: string; description: string }>` — the title and one-line explanation for each event's row in the account settings dialog.
