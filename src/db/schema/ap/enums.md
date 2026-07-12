## enums.ts

**Purpose:** Declares every `pgEnum` shared by the `ap_*` tables — the two `ap_character` enums plus the map/connection enums.
**File:** `src/db/schema/ap/enums.ts`

---

### characterStatus
`pgEnum('character_status', ['active', 'kicked', 'banned'])` — per-character moderation state, modelled as a single state machine.

### authzLevel
`pgEnum('authz_level', ['member', 'admin'])` — in-app authority level on `ap_character`; gates the `/admin` operator console. `admin` (global deployment operator) is reachable only via an explicit `ap_access_grant` (`capability='admin'`). Corp/alliance map authority is NOT a tier here — it is the derived `ap_character.is_director` bit consumed by `canManageMap` / `canCreateMap`. The `manager` tier was removed in migration 0041.

### mapScope
`pgEnum('map_scope', ['wh', 'k_space', 'none', 'all'])` — which kinds of systems a map may hold. On `ap_map`.

### mapType
`pgEnum('map_type', ['private', 'corp', 'alliance'])` — map ownership/visibility class. On `ap_map`.

### systemStatus
`pgEnum('system_status', ['unknown', 'friendly', 'occupied', 'hostile', 'empty', 'unscanned'])` — per-system intel state driving node colour. On `ap_map_system`, default `unknown`.

### mapNoteSeverity
`pgEnum('map_note_severity', ['neutral', 'green', 'yellow', 'red'])` — severity band of a free-standing map note, driving the note node's border colour. On `ap_map_note`, default `neutral`. Added migration 0044 (map notes, issue #5).

### connectionScope
`pgEnum('connection_scope', ['wh', 'stargate', 'jumpbridge', 'abyssal'])` — what kind of link a connection is. On `ap_map_connection`.

### whMass
`pgEnum('wh_mass', ['fresh', 'reduced', 'critical'])` — wormhole remaining-mass band. On `ap_map_connection`, default `fresh`.

### whJumpMass
`pgEnum('wh_jump_mass', ['s', 'm', 'l', 'xl'])` — per-jump mass class (max ship size) of a wormhole. Nullable on `ap_map_connection` (non-WH links leave it null).

### routeSafety
`pgEnum('route_safety', ['shortest', 'safer', 'less_safe'])` — route-planner safety preference (EVE autopilot semantics) on `ap_user.route_safety`, default `shortest`. `shortest` ignores security; `safer` heavily penalizes low/null/J-space transit in the Dijkstra weighting but still routes through it when forced (a reachable destination is never reported unreachable); `less_safe` inverts the penalty. Added migration 0036 (routes-module). Consumed by `src/lib/map/routePlanner.ts`.

### eolStage
`pgEnum('eol_stage', ['none', 'eol', 'critical', 'expired'])` — end-of-life stage of a wormhole. Replaces the earlier `is_eol` boolean (migration 0031); `expired` added migration 0053. `none` is a hole not yet decaying; `eol` (~4h) and `critical` (~1h) are EVE's two timed decay warnings; `expired` (migration 0053) is EVE's terminal "expiration imminent" / Expired state. On `ap_map_connection` and `ap_map_signature`, default `none`. The `eol`/`critical` stage selects which lifetime constant (`WORMHOLE_EOL_LIFETIME_MS` vs `WORMHOLE_EOL_CRITICAL_LIFETIME_MS`) drives the countdown + EOL-expiry reap; `eol_at` is re-stamped on each stage change. `expired` is set only manually; it shows an elapsed-since readout instead of a countdown and the EOL-expiry reaper purges it `WORMHOLE_EXPIRED_LIFETIME_MS` (4h) after `eol_at` on opt-in maps.

### apWebhookChannel
`pgEnum('ap_webhook_channel', ['discord'])` — outbound chat channel for an `ap_map_webhook` row. Currently Discord only; adding `'slack'` is a one-line `ALTER TYPE` migration plus a sibling client module.

### apWebhookEvent
`pgEnum('ap_webhook_event', ['history', 'rally'])` — which class of map events a webhook subscribes to. `history` mirrors every `ap_map_event` insert on the map; `rally` fires only when a `system.updated` event carries a non-null `rallyAt` (rally set, not cleared).

### mapRight
`pgEnum('map_right', ['map_create', 'map_update', 'map_delete', 'map_import', 'map_export', 'map_share'])` — the map-management rights vocabulary, reserved for the future title-delegation overlay (R4). No table stores these (the `ap_corporation_right` matrix was retired in 0041); at the baseline the mutate guards take a `MapRight` argument but ignore it (authority is the binary `canManageMap`).

### mapCapability
`pgEnum('map_capability', ['view', 'audit_view', 'settings_manage', 'webhooks_manage', 'map_import', 'map_export', 'map_delete'])` — the per-map delegatable feature surface on `ap_map_role_access.capability` (added migration 0056). Each value names one director-gated feature a corp title can be granted on a single map. `view` is the role→map view overlay (any feature grant implies view); the rest map one-to-one onto the director features (audit log, settings, webhooks, import, export, delete). Distinct from `map_right`, which mixes in non-delegatable, non-per-map values and lacks the `audit_view`/`settings_manage`/`webhooks_manage` verbs. Directors/owners/admins hold every capability implicitly (`canManageMap`), so a grant only ever adds a title.

### signatureGroupKey
`pgEnum('signature_group_key', ['combat', 'relic', 'data', 'gas', 'wormhole', 'ore', 'ghost'])` — scanner-level group of a cosmic signature (the seven keys EVE's probe scanner emits in its "Group" column). Nullable on `ap_map_signature.group_key`; replaced the prior `group_id` FK to `universe_group` (migration 0015), which couldn't represent the cosmic six.

### signatureClassKind
`pgEnum('signature_class_kind', ['signature', 'anomaly'])` — whether a scanner entry must be scanned down (`signature`) or is instantly warpable (`anomaly`). Paste-derived from EVE's localized "Cosmic Signature" / "Cosmic Anomaly" Class column via `signatureClassKind` (`src/lib/map/signatureClasses.ts`). Nullable on `ap_map_signature.class_kind` (legacy + low-information manual rows have no known kind). Added migration 0045.

### signatureActivity
`pgEnum('signature_activity', ['combat', 'exploration'])` — site-safety of a cosmic signature: whether running the site pits you against rats (`combat`) or is an unguarded scan-down (`exploration`). The override axis behind `ap_map_signature.activity_override`; the derived default comes from `siteActivity` (`src/lib/map/siteActivity.ts`). Orthogonal to `signature_group_key` (a `relic` site can be a `combat` activity), so it is its own type. Added migration 0048.

### roleSource
`pgEnum('role_source', ['builtin', 'corp_title', 'external'])` — where an `ap_role` row originates. `corp_title` rows are mirrored from EVE corporation titles; `external_ref` is `'<corp_id>:<title_id>'`. `external` rows come from Discord/third-party syncs.

### structureEventKind
`pgEnum('structure_event_kind', ['create', 'update', 'delete'])` — the mutation recorded in `ap_structure_event`, the append-only accountability log for manual structure intel.

### tagScheme
`pgEnum('tag_scheme', ['none', 'abc', '0121'])` — the auto-tagging scheme a map runs (`ap_map.tag_scheme`, default `none`). `abc` = per-WH-class sequential letters; `0121` = positional chain numbering off the Home system. Adding a third scheme is additive (one `ALTER TYPE … ADD VALUE` + a strategy module + a `registry.ts` line).

### accessMode
`pgEnum('access_mode', ['open', 'restricted'])` — instance-wide login policy on `ap_instance` (default `restricted`). `open` = any EVE account may log in; `restricted` = login gated by owner membership + the `ap_access_grant` allowlist. Read by the Auth.js `signIn` gate.

### accessPrincipal
`pgEnum('access_principal', ['character', 'corporation', 'alliance', 'role'])` — what kind of entity an `ap_access_grant` / `ap_instance_owner` row names. `character`/`corporation`/`alliance` carry EVE ids; `role` carries an `ap_role.id`. `ap_instance_owner` is CHECK-constrained to `corporation`/`alliance`; `ap_access_grant` accepts all four.

### accessScope
`pgEnum('access_scope', ['instance', 'map'])` — the reach of an `ap_access_grant` row. `instance` grants carry NULL `map_id` (login/admin); `map` grants carry a non-NULL `map_id` (view/edit — reserved for the sharing feature). A CHECK ties scope to `map_id` nullness.

### accessCapability
`pgEnum('access_capability', ['login', 'admin', 'view', 'edit'])` — what an `ap_access_grant` row permits. `login`/`admin` are instance-scoped (allowlist entry / super-admin); `view`/`edit` are map-scoped and reserved for the temporary-sharing feature (declared to avoid a future `ALTER TYPE`). A CHECK pairs capability with scope. The `manage` capability (the old manager hand-grant) was retired in migration 0041.

### errorLevel
`pgEnum('error_level', ['warn', 'error', 'fatal'])` — severity of an `ap_error_log` row, mirroring the pino levels the structured logger ([[logger]]) emits. Only `error`/`fatal` are persisted today (the persist threshold in `src/lib/log/logger.ts`); `warn` is declared so the threshold could be lowered later without an `ALTER TYPE`. Added migration 0045 (observability phase 4).

### errorSource
`pgEnum('error_source', ['server', 'job', 'client'])` — where an `ap_error_log` row originated: `server` (request/action path), `job` (background worker), `client` (browser ingest, Phase 7). `client` is declared now to avoid a later `ALTER TYPE`. Added migration 0045.
