## webhook-formatters.test.ts

**Purpose:** Unit coverage for the pure webhook / audit formatters in `src/lib/webhooks/formatters.ts`, pinning the rendered text for each `MapEventPayload` variant.
**File:** `tests/unit/webhook-formatters.test.ts`

- `isRallySetEvent` — true only for a `system.updated` with a non-empty `rallyAt`.
- `formatHistoryMessage` — system, connection and signature lines (field-by-field `connection.update` / `signature.update` change lists, housekeeping-field suppression, link/unlink destinations, created-sig classification), the `Aperture` fallback actor, Blackout's actor-less form, and `null` for position-only or unrecognised updates. Includes an auto-EOL `connection.update` described as `EOL estimated from age → ~4h` (an `observed` one as `EOL → ~4h`) and `isEolEstimateEvent` telling the two apart.
- `describeMapEvent` — user API and API-token events named from the payload with no actor (and no owner under Blackout), plus the actor prefix the Discord history line adds.
- `formatRallyMessage` — the rally embed.
