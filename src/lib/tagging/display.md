## display.ts

**Purpose:** Pure display helper for rendering a system's class band and auto-tag as one label. Client-safe.
**File:** `src/lib/tagging/display.ts`

---

### classTagLabel(security: string | null | undefined, tag: string | null | undefined, scheme: TagScheme): string
The single-line class+tag label used by the dense sidebar tables (the Signatures panel's "Leads to" dropdown, the Signature Search "System" column). On `none`/`abc` maps it concatenates class then tag (`C2` + `G` → `C2G`). On a `0121` map the tag alone is returned, because that scheme's tags are numeric and the concatenation can't be split back apart (`C32` would read as both a C3 tagged `2` and a class 32); an untagged system falls back to its class band.

**Parameters:**
- `security` — `universe_system.security` label (`C1`..`Cn`, `H`/`L`/`0.0`, `A`/`P`) or null
- `tag` — the assigned tag token, or null
- `scheme` — the map's `ap_map.tag_scheme`

**Returns:** The label, or `''` when neither a class nor a tag is known.
