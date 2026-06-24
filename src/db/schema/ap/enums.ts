import { pgEnum } from 'drizzle-orm/pg-core';

// These two enums are needed by `ap_character` at table-create time; the
// remaining map/connection enums below reuse them.

/** Per-character moderation state. */
export const characterStatus = pgEnum('character_status', ['active', 'kicked', 'banned']);

/**
 * In-app authority level. `admin` is the deployment operator (global) and is
 * reached only via an explicit `ap_access_grant` (`capability='admin'`);
 * everyone else is `member`. Corp/alliance map-management authority is NOT a
 * tier here — it is the derived `ap_character.is_director` bit consumed by
 * `canManageMap` / `canCreateMap`.
 */
export const authzLevel = pgEnum('authz_level', ['member', 'admin']);

/** What kinds of systems a map is allowed to hold. */
export const mapScope = pgEnum('map_scope', ['wh', 'k_space', 'none', 'all']);

/** Map ownership/visibility class. */
export const mapType = pgEnum('map_type', ['private', 'corp', 'alliance']);

/** Per-system intel state shown by node colour. */
export const systemStatus = pgEnum('system_status', [
  'unknown',
  'friendly',
  'occupied',
  'hostile',
  'empty',
  'unscanned',
]);

/**
 * Severity band of a free-standing map note, driving the note node's border
 * colour. `neutral` is the default (no alarm); `green`/`yellow`/`red` escalate.
 */
export const mapNoteSeverity = pgEnum('map_note_severity', ['neutral', 'green', 'yellow', 'red']);

/** What kind of link a connection represents. */
export const connectionScope = pgEnum('connection_scope', [
  'wh',
  'stargate',
  'jumpbridge',
  'abyssal',
]);

/** Wormhole remaining-mass band. */
export const whMass = pgEnum('wh_mass', ['fresh', 'reduced', 'critical']);

/** Per-jump mass class of a wormhole (max ship size). Nullable for non-WH links. */
export const whJumpMass = pgEnum('wh_jump_mass', ['s', 'm', 'l', 'xl']);

/**
 * Route-planner safety preference, mirroring EVE's in-game autopilot. `shortest`
 * ignores security (fewest jumps); `safer` heavily penalizes low/null/J-space
 * transit but still routes through it when that's the only path (a reachable
 * destination is never reported unreachable); `less_safe` inverts the penalty to
 * prefer low/null. Stored per-account on `ap_user.route_safety`.
 */
export const routeSafety = pgEnum('route_safety', ['shortest', 'safer', 'less_safe']);

/**
 * End-of-life stage of a wormhole connection. EVE surfaces two decay warnings:
 * `eol` ("reaching the end of its natural lifetime", ~4h left) and the newer
 * `critical` final stage (~1h left). `none` is a hole not yet decaying. The
 * stage selects which lifetime constant drives the countdown + EOL-expiry reap
 * (`WORMHOLE_EOL_LIFETIME_MS` vs `WORMHOLE_EOL_CRITICAL_LIFETIME_MS`).
 */
export const eolStage = pgEnum('eol_stage', ['none', 'eol', 'critical']);

/**
 * Outbound chat channel for `ap_map_webhook`. Currently Discord only;
 * adding `'slack'` is one `ALTER TYPE ap_webhook_channel ADD VALUE` plus
 * a sibling `src/lib/integrations/slack.ts`.
 */
export const apWebhookChannel = pgEnum('ap_webhook_channel', ['discord']);

/**
 * Which event class a webhook subscribes to. `history` mirrors every
 * `ap_map_event` insert on the map; `rally` fires only when a `system.updated`
 * event carries a non-null `rallyAt` (rally set, not cleared).
 */
export const apWebhookEvent = pgEnum('ap_webhook_event', ['history', 'rally']);

/**
 * The map-management rights vocabulary. Reserved as the granular delegation
 * vocabulary for the future title-delegation overlay (R4); at the baseline the
 * mutate guards take a `MapRight` argument but ignore it (authority is the
 * binary `canManageMap`). No table stores these today — the old
 * `ap_corporation_right` matrix was retired in 0041.
 */
export const mapRight = pgEnum('map_right', [
  'map_create',
  'map_update',
  'map_delete',
  'map_import',
  'map_export',
  'map_share',
]);

/**
 * Scanner-level group of a cosmic signature. The seven keys EVE's in-game
 * probe scanner emits in its "Group" column: six cosmic-site classes plus
 * wormhole. Replaces the prior `ap_map_signature.group_id` FK to
 * `universe_group`, which couldn't represent the cosmic six (only `Wormhole`
 * and `Cosmic Signature` exist in the SDE at group granularity). The actual
 * site name (e.g. "Forgotten Perimeter Habitation Coils") lives in
 * `ap_map_signature.name`; for wormhole sigs `type_id` still resolves to a
 * `universe_wormhole` row.
 */
export const signatureGroupKey = pgEnum('signature_group_key', [
  'combat',
  'relic',
  'data',
  'gas',
  'wormhole',
  'ore',
  'ghost',
]);

/**
 * Where an `ap_role` row originates.
 * - `builtin` — created by the app itself (e.g. seed roles, admin-panel hand-grants).
 * - `corp_title` — mirrored from an EVE corporation title pulled via
 *   `esi-characters.read_titles.v1`; `external_ref` is `'<corporation_id>:<title_id>'`.
 * - `external` — synced from a third-party system (Discord, etc.); `external_ref`
 *   carries the upstream role id.
 */
export const roleSource = pgEnum('role_source', ['builtin', 'corp_title', 'external']);

/**
 * The mutation recorded in `ap_structure_event` — the append-only
 * accountability log for manual structure intel. Structures are deployment-global
 * and editable by any authenticated user, so every create/update/delete is
 * stamped with the acting character to identify griefers. (Structures have no
 * `map_id` and therefore cannot live in `ap_map_event`; this is their dedicated,
 * single-source history.)
 */
export const structureEventKind = pgEnum('structure_event_kind', ['create', 'update', 'delete']);

/**
 * The auto-tagging scheme a map runs (`ap_map.tag_scheme`).
 * - `none` — no auto-tagging; the `tag` column is manual-only.
 * - `abc` — per-WH-class sequential letters (A, B, C, … per class).
 * - `0121` — positional chain numbering off the map's Home system.
 *
 * Adding a third scheme is additive: one `ALTER TYPE tag_scheme ADD VALUE`, a
 * new strategy module under `src/lib/tagging/`, and one line in
 * `src/lib/tagging/registry.ts`. The existing two schemes are never touched.
 */
export const tagScheme = pgEnum('tag_scheme', ['none', 'abc', '0121']);

/**
 * Whether the deployment admits any EVE login (`open`) or only allowlisted
 * principals (`restricted`, the default). Read by the Auth.js `signIn` gate and
 * stored on `ap_instance`.
 */
export const accessMode = pgEnum('access_mode', ['open', 'restricted']);

/**
 * What kind of entity an access grant / instance owner
 * names. `character`, `corporation`, `alliance` carry EVE ids; `role` carries
 * an `ap_role.id`. `ap_instance_owner` constrains itself to corp/alliance via
 * a CHECK; `ap_access_grant` accepts all four.
 */
export const accessPrincipal = pgEnum('access_principal', [
  'character',
  'corporation',
  'alliance',
  'role',
]);

/**
 * The reach of an `ap_access_grant` row. `instance`
 * grants (login/admin/manage) carry NULL `map_id`; `map` grants (view/edit,
 * reserved for the sharing feature) carry a non-NULL `map_id`. The
 * scope↔map_id pairing is enforced by a CHECK.
 */
export const accessScope = pgEnum('access_scope', ['instance', 'map']);

/**
 * What an access grant permits. `login`/`admin` are instance-scoped (allowlist
 * entry / super-admin); `view`/`edit` are map-scoped and reserved for the
 * temporary-sharing feature — declared so adding sharing needs no
 * `ALTER TYPE access_capability ADD VALUE`. The capability↔scope pairing is
 * enforced by a CHECK.
 */
export const accessCapability = pgEnum('access_capability', [
  'login',
  'admin',
  'view',
  'edit',
]);
