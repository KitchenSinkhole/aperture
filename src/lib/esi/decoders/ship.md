## ship.ts

**Purpose:** Zod decoder for `getCharacterShip`. The location-poll persists `ship_type_id` to `ap_character.last_ship_type_id` for the head breadcrumb; `ship_name` feeds the presence hover panel.
**File:** `src/lib/esi/decoders/ship.ts`

---

### normalizeShipName(raw: string): string
Cleans two independent ESI quirks in `get_characters_character_id_ship`'s `ship_name`, in order:

1. **Python `repr()` wrapper** — the field comes back as `u'๓...'` when the name contains non-ASCII characters (plain string otherwise). Detects the `u'…'` / `u"…"` wrapper and decodes the inner Python string escapes (`\uXXXX`, `\U00XXXXXX`, `\xXX`, and the simple `\n \t \\ \' …` set). A value not matching the wrapper passes to step 2 unchanged.
2. **HTML entity encoding** — ESI entity-encodes the reserved characters `< > &`, so the `><>` fish name arrives as `&gt;&lt;&gt;`. Decodes the named entities `&amp; &lt; &gt; &quot; &apos;` plus any decimal (`&#62;`) or hex (`&#x3c;`) numeric reference. Unknown named entities and bare `&` are left verbatim.

**Returns:** The real Unicode ship name.

---

### characterShipSchema → EsiCharacterShip
`getCharacterShip` (`get_characters_character_id_ship`): `{ ship_type_id, ship_item_id, ship_name }` — all required per swagger. `ship_name` is run through `normalizeShipName` via a Zod `.transform`, so consumers always receive a real string.

`ship_item_id` is per-ship-instance (persists until repackaged); the poll captures it in the decoded shape but doesn't store it today. Useful for a future "did the pilot swap ships?" signal.
