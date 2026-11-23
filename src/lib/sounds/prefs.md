## prefs.ts

**Purpose:** The sound-cue vocabulary and the account-level preference blob stored on `ap_user.sound_prefs`, with both a strict boundary validator and a lenient reader.
**File:** `src/lib/sounds/prefs.ts`

Pure — no browser and no server imports — so a Server Action, the session reader and client code all share it. The types are re-exported from `src/types/index.ts`.

---

### SOUND_EVENTS
The closed vocabulary of cues the engine plays, including experimental-only `activeRouteOffRoute` and `activeRouteLinkAlert`.

### EXPERIMENTAL_SOUND_EVENTS
`Set` of events shown in account Sounds only when experimental UI is on.

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
`{ enabled: boolean; sound: SoundId; toast?: boolean; desktopNotification?: boolean }` — experimental alert rows (`rallySet`, `activeRouteOffRoute`, `activeRouteLinkAlert`) use `toast` and `desktopNotification` independently of master sound mutes.

### SoundPrefs (type)
`{ enabled: boolean; volume: number; events: Record<SoundEvent, SoundEventPrefs>; homeMutes: SoundMutes; systemMutes: SystemSoundMute[] }`. `volume` is master gain, 0..1. `homeMutes` applies to whichever system is the Home of the map being viewed; `systemMutes` holds only entries with at least one group muted.

### SOUND_MUTE_GROUPS / SoundMuteGroup (type)
`['kills', 'pilots', 'alerts']` — the cue groups a system can be muted for.

### SOUND_MUTE_GROUP_OF
`Record<SoundEvent, SoundMuteGroup | null>`: `killInSystem` → `kills`; `pilotArrived` / `pilotLeft` → `pilots`; `rallySet` / `systemPinged` → `alerts`; `watchedJump` → `null`. A watched wormhole is an explicit opt-in, so no system mute silences it.

### SoundMutes (type)
`Record<SoundMuteGroup, boolean>`; `true` silences that group's cues.

### SystemSoundMute (type)
`SoundMutes & { systemId: number; name: string }`. Keyed by EVE solar-system id, so one entry holds on every map. `name` is stored for the settings list, which has no universe lookup.

### MAX_SYSTEM_SOUND_MUTES
`50` — the cap on `systemMutes`.

### SoundCueSystem (type)
`{ systemId: number; isHome: boolean }` — the system a cue happened in (EVE id) and whether it is the open map's Home.

### DEFAULT_SOUND_VOLUME
`0.7`.

### DEFAULT_SOUND_PREFS
Master off, every event off, volume `DEFAULT_SOUND_VOLUME`, default chimes per event (including experimental `activeRouteOffRoute` / `activeRouteLinkAlert`). Sounds are opt-in. `homeMutes` mutes `pilots` only; `systemMutes` is empty.

---

### soundMutesFor(prefs: SoundPrefs, system: SoundCueSystem): SoundMutes
The groups muted in `system`: its `systemMutes` entry, OR-ed with `homeMutes` when `system.isHome`.

### isCueMutedInSystem(prefs: SoundPrefs, event: SoundEvent, system: SoundCueSystem): boolean
Whether `event`'s group is muted in `system`. Always `false` for `watchedJump`.

### isSystemMuteListFull(prefs: SoundPrefs, system: SoundCueSystem): boolean
Whether muting a group in `system` would need a new `systemMutes` entry past `MAX_SYSTEM_SOUND_MUTES`. Always `false` for Home (which writes `homeMutes`) and for a system already listed.

### setSystemSoundMute(prefs, system: SoundCueSystem & { name: string }, group: SoundMuteGroup, muted: boolean): SoundPrefs
Returns prefs in which `soundMutesFor(system)[group] === muted`. Muting Home writes `homeMutes`; muting any other system adds or updates its `systemMutes` entry. Unmuting clears the group from both `homeMutes` (when Home) and the system's entry, since either alone keeps the cue silent; an entry left with nothing muted is dropped. A mute blocked by the cap returns `prefs` unchanged.

### removeSystemSoundMute(prefs: SoundPrefs, systemId: number): SoundPrefs
Drops that system's `systemMutes` entry.

---

### isSoundId(value: unknown): value is SoundId
Type guard for a built-in id or a well-formed `custom:<uuid>` id (a bare `custom:` prefix or a non-UUID suffix fails).

---

### soundPrefsSchema
Zod schema for the whole blob: `enabled` boolean, `volume` a number in 0..1, an `events` object carrying every event in `SOUND_EVENTS`, each `{ enabled: boolean, sound }` with `sound` guarded by `isSoundId`, `homeMutes` (three booleans), and `systemMutes` (at most `MAX_SYSTEM_SOUND_MUTES` entries, each a positive integer `systemId`, a 1–100 char `name` and three booleans, with no `systemId` repeated). The id union is load-bearing here: a save naming an id outside `BUILT_IN_SOUND_IDS` (and not a well-formed `custom:` id) is rejected. Strict — a malformed blob is rejected rather than repaired, so a broken client cannot quietly rewrite the account's prefs. Used at the Server Action boundary.

---

### resolveSoundPrefs(raw: unknown): SoundPrefs
Read side of the same blob. Fills every missing or mistyped field from `DEFAULT_SOUND_PREFS` field by field, so a NULL column, a partial object or outright garbage all yield usable prefs. A non-finite or non-numeric volume falls back to the default; an in-range number is kept and an out-of-range one is clamped to 0..1. A sound id that fails `isSoundId` falls back to that event's default chime. Each `homeMutes` flag falls back to its default on its own; `systemMutes` keeps only well-formed entries (positive integer id, non-empty name, first occurrence of an id, at least one group muted), up to the cap. Returns a fresh object graph — the caller may mutate it without touching `DEFAULT_SOUND_PREFS`.

**Returns:** A complete `SoundPrefs` with every event in `SOUND_EVENTS` present.
