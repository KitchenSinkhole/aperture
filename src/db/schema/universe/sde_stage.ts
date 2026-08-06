import { index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';

export const universeSdeStage = pgTable(
  'universe_sde_stage',
  {
    runId: uuid('run_id').notNull(),
    tableName: text('table_name').notNull(),
    idA: integer('id_a').notNull(),
    idB: integer('id_b'),
  },
  (t) => [index('universe_sde_stage_key_idx').on(t.runId, t.tableName, t.idA, t.idB)],
);
