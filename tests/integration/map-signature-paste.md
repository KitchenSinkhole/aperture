## map-signature-paste.test.ts

**Purpose:** Integration coverage for `pasteSignatures` — the bulk orchestrator. Verifies the diff matrix, exact `ap_map_event` count, end-state correctness, optional orphan-connection tear-down, and atomic rollback on partial failure.
**File:** `tests/integration/map-signature-paste.test.ts`

Gated on `RUN_DB_TESTS=1`. Runs against the migrated Postgres in `docker-compose`.

Cases:
1. **Diff**: 1 pre-existing classified + 1 unclassified seed; paste classifies one, adds two new, omits one with `removeMissing: true` → 4 `ap_map_event` rows; `name` on the updated row is preserved.
2. **Blank-name fill**: a sig first added blind (group set, `name` null) gets its `name` populated by a later high-strength re-paste, while a sibling with a hand-typed name is left untouched — covers the "low-strength scan → high-strength reveal" bug without clobbering typed input.
3. **Expired-ghost sweep on re-paste**: a sig seeded with an already-past `expires_at` (reap cron hasn't run yet) is re-pasted; the dead row is swept (uncounted `signature.delete`) and the sig is re-created fresh — summary is `added: 1, updated: 0`, two payloads (delete + create), and the surviving row has a future expiry and a new id. Regression guard for the "expired-but-unreaped ghost silently swallows a paste" bug.
4. **removeOrphanedConnections**: an existing sig is bound to a WH connection; an empty paste with both `removeMissing` and `removeOrphanedConnections` deletes the sig AND the connection (`signature.delete` + `connection.delete` events).
5. **Rollback**: seeded sig + paste that would re-add the same `sigId` (with `updateExisting: false`) triggers the `(map_system_id, sig_id)` unique-constraint violation; the whole batch rolls back so no new events land and the other rows in the paste don't persist.
