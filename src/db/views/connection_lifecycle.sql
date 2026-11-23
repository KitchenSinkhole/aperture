-- One lifecycle row per dead connection, projected from the death snapshot that
-- every `connection.delete` event carries (`readConnectionDeathSnapshot`). The
-- connection row, its mass log and its bound signatures all cascade away at
-- delete, so the event payload is the only durable record of the death.
--
-- Only snapshotted deletes are rows (`payload ? 'cause'`). A delete event with
-- no cause has no last-alive or death state to project.
--
-- The view reads the delete event alone. `bornAt` is the row's `created_at`;
-- pairing with `connection.create` would fan out, because a restore or a
-- location-poll reconfirm re-emits `connection.create` for the same id.
--
-- Enum-valued payload fields stay `text`, so an unrecognised value never makes
-- the view error. Endpoints LEFT JOIN `ap_map_system`, so a missing node row
-- never drops a death. No map, scope or deletion filtering: that is the query's
-- job.

CREATE VIEW "ap_connection_lifecycle" AS
SELECT
  e.id                                                    AS event_id,
  e.map_id                                                AS map_id,
  (e.payload ->> 'id')::bigint                            AS connection_id,
  e.payload ->> 'scope'                                   AS scope,
  (e.payload ->> 'source')::bigint                        AS source_map_system_id,
  (e.payload ->> 'target')::bigint                        AS target_map_system_id,
  src.system_id                                           AS source_system_id,
  tgt.system_id                                           AS target_system_id,
  e.payload ->> 'wormholeCode'                            AS wormhole_code,
  (e.payload ->> 'isStatic')::boolean                     AS is_static,
  (e.payload ->> 'bornAt')::timestamptz                   AS born_at,
  e.occurred_at                                           AS died_at,
  (EXTRACT(EPOCH FROM e.occurred_at - (e.payload ->> 'bornAt')::timestamptz) / 3600)::double precision
                                                          AS lifetime_h,
  e.payload ->> 'cause'                                   AS cause,
  (e.payload ->> 'lastAliveAt')::timestamptz              AS last_alive_at,
  (EXTRACT(EPOCH FROM e.occurred_at - (e.payload ->> 'lastAliveAt')::timestamptz) / 3600)::double precision
                                                          AS clear_lag_h,
  e.payload ->> 'massStatus'                              AS mass_status_at_death,
  COALESCE(
    e.payload ->> 'cause' = 'rolled'
      OR e.payload ->> 'isRolling' = 'true'
      OR e.payload ->> 'massStatus' = 'critical',
    false
  )                                                       AS was_rolled,
  (e.payload ->> 'wasDormant')::boolean                   AS was_dormant,
  e.payload ->> 'eolStage'                                AS eol_stage_at_death,
  (e.payload ->> 'eolAt')::timestamptz                    AS eol_at,
  -- Snapshots without `eolSource` predate auto-marking, when every EOL was human.
  CASE
    WHEN e.payload ? 'eolSource' THEN e.payload ->> 'eolSource'
    WHEN e.payload ->> 'eolStage' <> 'none' THEN 'observed'
  END                                                     AS eol_source
FROM "ap_map_event" e
LEFT JOIN "ap_map_system" src ON src.id = (e.payload ->> 'source')::bigint
LEFT JOIN "ap_map_system" tgt ON tgt.id = (e.payload ->> 'target')::bigint
WHERE e.kind = 'connection.delete'
  AND e.payload ? 'cause';
