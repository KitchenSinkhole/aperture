# Drizzle Schema Index

Single Postgres database, single schema. Static CCP data uses the `universe_` prefix
(mandatory). Columns are `snake_case` in the DB, `camelCase` in TS via Drizzle `name:`.
Universe spatial IDs are `integer`; coords are `doublePrecision`. All time columns are
`timestamptz`. Real FKs across former schema boundaries.

Barrel: `src/db/schema/index.ts` re-exports every table + the effective-dogma view.
Row types are inferred and re-exported from `src/types/index.ts`.

## `universe/geography.ts`

| Table (`const`) | DB name | Key columns / FKs |
|---|---|---|
| `universeRegion` | `universe_region` | `id` int PK, `name`, `description` |
| `universeConstellation` | `universe_constellation` | `id` int PK, `region_id` → region **CASCADE**, `name`, `x`/`y`/`z` double |
| `universeSystem` | `universe_system` | `id` int PK, `constellation_id` → constellation **CASCADE**, `name`, `security` (label `H`/`L`/`0.0`/`C1`–`C6`/`P`/`A`), `true_sec` double, `security_status` double, `security_class`, `effect`, `x`/`y`/`z` double |
| `universeStargateEdge` | `universe_stargate_edge` | `from_system_id` → system **CASCADE**, `to_system_id` → system **CASCADE**, PK `(from,to)`, index on `to_system_id` |

## `universe/items.ts`

| Table (`const`) | DB name | Key columns / FKs |
|---|---|---|
| `universeCategory` | `universe_category` | `id` int PK, `name`, `published` bool |
| `universeGroup` | `universe_group` | `id` int PK, `category_id` → category **CASCADE**, `name`, `published` bool |
| `universeType` | `universe_type` | `id` int PK, `group_id` → group **CASCADE**, `name`, `description`, `mass`/`volume`/`capacity`/`radius`/`packaged_volume` double, `portion_size`/`market_group_id`/`graphic_id` int, `published` bool |

## `universe/dogma.ts`

| Table (`const`) | DB name | Key columns / FKs |
|---|---|---|
| `universeDogmaAttribute` | `universe_dogma_attribute` | `id` int PK, `name`, `display_name`, `description`, `published`/`stackable`/`high_is_good` bool, `default_value` double, `icon_id`/`unit_id` int |
| `universeTypeAttribute` | `universe_type_attribute` | `type_id` → type **CASCADE**, `attribute_id` → dogma_attribute **CASCADE**, `value` double, PK `(type_id, attribute_id)` |
| `universeTypeOverride` | `universe_type_override` | `type_id` → type **CASCADE**, `attr_id` int, `value` double NOT NULL, `reason`, `updated_at` timestamptz default now(), PK `(type_id, attr_id)` |

## `universe/statics.ts`

| Table (`const`) | DB name | Key columns / FKs |
|---|---|---|
| `universeSystemStatic` | `universe_system_static` | `system_id` → system **CASCADE**, `type_id` → type **CASCADE**, PK `(system_id, type_id)`. Per-system WH statics (anoik.is /systems) |
| `universeWormhole` | `universe_wormhole` | `type_id` PK → type **CASCADE**, `name`, `source_classes` (text[]; set of spawn classes, null = unspecified), `target_class` (class label; null = unknown), `target_system_id` → system **RESTRICT** (fixed-destination holes, e.g. J377 → Turnur; null for normal holes). Hand-maintained WH-type routing catalog |

## `universe/sde_stage.ts`

Per-table detail in the companion `.md` beside the schema file.

| Table (`const`) | DB name | Key columns / FKs |
|---|---|---|
| `universeSdeStage` | `universe_sde_stage` | **UNLOGGED** (migration 0067). `run_id` uuid, `table_name` text, `id_a`/`id_b` int (`id_b` null for single-PK tables), no PK, index `(run_id, table_name, id_a, id_b)`. Ingest scratch: the new build's key set, staged during the write phase and read by `syncSdeDeletions`'s anti-joins |

## `universe/sovereignty.ts`, `universe/incursion.ts`, `universe/entityName.ts` (mutable ESI caches)

Per-table detail in the companion `.md` beside each schema file. Live beside the static `universe_*` tables but are ESI-fed and refreshed by cron jobs.

| Table (`const`) | DB name | Key columns / FKs |
|---|---|---|
| `universeSovereigntyMap` | `universe_sovereignty_map` | `system_id` int PK → system **CASCADE**, `faction_id`/`alliance_id`/`corporation_id` bigint. `sov-fw-refresh` |
| `universeFactionWarSystem` | `universe_faction_war_system` | `system_id` int PK → system **CASCADE**, `owner_faction_id`/`occupier_faction_id` bigint, `contested` text, `victory_points`/`victory_points_threshold` int. `sov-fw-refresh` |
| `universeIncursion` | `universe_incursion` | `constellation_id` int PK → constellation **CASCADE**, `faction_id` bigint, `staging_solar_system_id` int, `has_boss` bool, `influence` double, `state`/`type` text, `infested_solar_systems` jsonb (`number[]`). `incursion-refresh` (5-min, full replace) |
| `universeEntityName` | `universe_entity_name` | `id` bigint PK, `category` text, `name` text, `last_fetched_at` timestamptz. Generic id→name cache (faction/alliance/corp); warmed by the refresh jobs, read by the intel module |

## `universe/views.ts`

| View (`const`) | DB name | Notes |
|---|---|---|
| `universeTypeAttributeEffective` | `universe_type_attribute_effective` | `.existing()` typing handle. `COALESCE(override.value, type_attribute.value)` per `(type_id, attr_id)`. DDL in custom migration. |

## `ap/instance.ts`, `ap/access_grant.ts` (permissions overhaul)

Per-table detail lives in the companion `.md` beside each schema file. Migration `0034_permissions_overhaul`.

| Table (`const`) | DB name | Key columns / constraints |
|---|---|---|
| `apInstance` | `ap_instance` | singleton `id` smallint PK (CHECK `id = 1`), `access_mode` enum default `restricted`, `stale_signature_threshold_minutes` integer default 240 (migration `0035`), `updated_at` timestamptz |
| `apInstanceOwner` | `ap_instance_owner` | `principal_kind` enum (CHECK in `corporation`/`alliance`), `principal_id` bigint, PK `(principal_kind, principal_id)` |
| `apAccessGrant` | `ap_access_grant` | `id` bigserial PK, `principal_kind`/`principal_id`, `scope` enum, `map_id` → ap_map **CASCADE** (NULL ⇔ instance scope, CHECK), `capability` enum (CHECK paired to scope), `expires_at`, `note`, `granted_by_character_id` → ap_character **SET NULL**, `granted_at`. UNIQUE **NULLS NOT DISTINCT** `(principal_kind, principal_id, scope, map_id, capability)` |
