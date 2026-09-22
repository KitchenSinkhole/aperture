## prefs.ts

**Purpose:** The sound-cue vocabulary and the account-level preference blob stored on `ap_user.sound_prefs`, with both a strict boundary validator and a lenient reader.
**File:** `src/lib/sounds/prefs.ts`

Pure — no browser and no server imports — so a Server Action, the session reader and client code all share it. The types are re-exported from `src/types/index.ts`.

---

### SOUND_EVENTS
`['pilotArrived', 'pilotLeft', 'watchedJump', 'killInSystem']`. The closed vocabulary of cues the engine plays.

### SoundEvent (type)
`(typeof SOUND_EVENTS)[number]`.

### CHIME_SOUND_IDS
`['chime-up', 'chime-down', 'arpeggio', 'tick', 'tick-loud', 'ping', 'bell', 'beeps', 'alarm', 'klaxon']` — the chimes `catalog.ts` synthesizes, in picker order.

### VOICE_PACKS
`[{ id: 'ada', label: 'Ada' }, { id: 'cowboy', label: 'Cowboy' }, { id: 'malyx', label: 'Malyx' }]` — the recorded packs shipped under `public/sounds/voice/`.

### VOICE_SOUND_IDS
Every `voice-<pack>-<event>` id, one per pack per event. The watched-jump line splits by variant across three files, but all three share the one id.

### BUILT_IN_SOUND_IDS
`CHIME_SOUND_IDS` followed by `VOICE_SOUND_IDS` — every id the app ships, as opposed to a `custom:` id imported on one device.

### ChimeSoundId / VoicePack / VoicePackId / VoiceSoundId / BuiltInSoundId / CustomSoundId / SoundId (types)
`VoiceSoundId` is the template literal `voice-${VoicePackId}-${SoundEvent}`. `SoundId` is a built-in id or `custom:${string}`, the id of a sound file the user imported on this device.

### SoundVariant (type)
`'plain' | 'inbound' | 'outbound'` — which end of a watched wormhole the viewer sits on. Built-in chimes ignore it; the voice pack speaks a different line per variant.

### SoundEventPrefs (type)
`{ enabled: boolean; sound: SoundId }`.

### SoundPrefs (type)
`{ enabled: boolean; volume: number; events: Record<SoundEvent, SoundEventPrefs> }`. `volume` is master gain, 0..1.

### DEFAULT_SOUND_VOLUME
`0.7`.

### DEFAULT_SOUND_PREFS
Master off, every event off, volume `DEFAULT_SOUND_VOLUME`, and one chime per event: `pilotArrived` → `chime-up`, `pilotLeft` → `chime-down`, `watchedJump` → `tick`, `killInSystem` → `alarm`. Sounds are opt-in.

---

### isSoundId(value: unknown): value is SoundId
Type guard for a built-in id or a well-formed `custom:<uuid>` id (a bare `custom:` prefix or a non-UUID suffix fails).

---

### soundPrefsSchema
Zod schema for the whole blob: `enabled` boolean, `volume` a number in 0..1, and an `events` object carrying all four events, each `{ enabled: boolean, sound }` with `sound` guarded by `isSoundId`. The id union is load-bearing here: a save naming an id outside `BUILT_IN_SOUND_IDS` (and not a well-formed `custom:` id) is rejected. Strict — a malformed blob is rejected rather than repaired, so a broken client cannot quietly rewrite the account's prefs. Used at the Server Action boundary.

---

### resolveSoundPrefs(raw: unknown): SoundPrefs
Read side of the same blob. Fills every missing or mistyped field from `DEFAULT_SOUND_PREFS` field by field, so a NULL column, a partial object or outright garbage all yield usable prefs. A non-finite or non-numeric volume falls back to the default; an in-range number is kept and an out-of-range one is clamped to 0..1. A sound id that fails `isSoundId` falls back to that event's default chime. Returns a fresh object graph — the caller may mutate it without touching `DEFAULT_SOUND_PREFS`.

**Returns:** A complete `SoundPrefs` with every event in `SOUND_EVENTS` present.
