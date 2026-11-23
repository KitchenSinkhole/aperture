-- `ap_connection_lifecycle`: a plain view projecting every snapshotted
-- `connection.delete` event into one lifecycle row per dead connection.
-- Source of truth: `src/db/views/connection_lifecycle.sql`.
--
-- Rollback: src/db/migrations/0075_connection_lifecycle_view.rollback.sql.

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
  (e.payload ->> 'eolAt')::timestamptz                    AS eol_at
FROM "ap_map_event" e
LEFT JOIN "ap_map_system" src ON src.id = (e.payload ->> 'source')::bigint
LEFT JOIN "ap_map_system" tgt ON tgt.id = (e.payload ->> 'target')::bigint
WHERE e.kind = 'connection.delete'
  AND e.payload ? 'cause';
