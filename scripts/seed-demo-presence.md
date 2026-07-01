## seed-demo-presence.ts

**Purpose:** Dev-only seed that creates a self-contained "Demo Overlay" map with J160941 as the sole system and 5 fake online characters inside it, for eyeballing the SystemOverlay / PilotRoster in the browser.
**File:** `scripts/seed-demo-presence.ts`

---

### Usage

```
pnpm seed:demo-presence <system-name>
```

`<system-name>` is mandatory (e.g. `J160941`). The map is named `Demo Overlay <system-name>`. No other seed script needs to run first — this script is fully self-contained.

### Behaviour

- **Idempotent.** Tears down the "Demo Overlay" map and all fake character/user rows (keyed by IDs `2_000_000_001–005`) before re-inserting, so re-running is safe.
- **SDE-aware.** Looks up J160941 in `universe_system` first. If the SDE has been ingested (`pnpm sde:bootstrap`), uses the real system row. If not, inserts placeholder `universe_region → constellation → system` rows (all ID `99_000_001`) so the FK chain holds; those placeholder rows are removed on the next run.
- Inserts 5 `ap_user` + `ap_character` rows with `last_online = true` and `last_system_id` pointing at J160941. Character IDs (`2_000_000_001–005`) are well outside the real EVE player range (`90_000_000+`).
- Adds `ap_map_character_tracking` rows so `loadMapPresence` picks them up on the map page.
- Ship type names (Tengu, Stratios, Loki, Legion, Proteus) resolve only when the SDE is ingested; without it they appear blank in the overlay, but character names and custom ship names still show.
