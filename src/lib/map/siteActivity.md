## siteActivity.ts

**Purpose:** Classify a cosmic signature as a `combat` or `exploration` site (its running safety), independent of the scanner group.
**File:** `src/lib/map/siteActivity.ts`

The activity axis is orthogonal to `signature_group_key`: a `relic` or `data` site can be either activity depending on the site name. Derived defaults are vendored from the whtype.info "safe-explo" dataset (`SAFE → exploration`, `NOT SAFE → combat`); to update, edit the module and redeploy — the upstream file is not fetched at runtime. Pure and isomorphic (no `server-only`), so both the signature panel glyph and the search filter import it directly.

---

### type SignatureActivity = `'combat' | 'exploration'`
The two site-safety states. Re-exported from `src/types/index.ts`. The override column and enum use the same axis, orthogonal to `SignatureGroupKey`.

---

### siteActivity(name, groupKey): SignatureActivity | null
Derived site-safety from a signature's resolved site `name` and scanner `groupKey`. Returns `null` when there isn't enough to classify.

**Parameters:**
- `name` — the resolved EVE site name (e.g. `'Forgotten Perimeter Habitation Coils'`); `null`/blank for an unidentified site.
- `groupKey` — the scanner `SignatureGroupKey` (or `null`).

**Returns:** `'combat'` / `'exploration'` / `null`. `combat` for combat anomalies, ghost, and all gas reservoirs; `exploration` for ore. For relic/data, keyed on the site-name prefix: `Forgotten `/`Unsecured `/`Abandoned Research` → combat, `Ruined `/`Central ` → exploration. `wormhole`, unknown groups, and unidentified relic/data (no name) → `null`. Keys on `(name, groupKey)` together so the `Ordinary Perimeter Reservoir` (gas) vs `Ordinary Perimeter Deposit` (ore) collision resolves.

---

### effectiveSignatureActivity(sig): SignatureActivity | null
The value the UI shows: `sig.activityOverride ?? siteActivity(sig.name, sig.groupKey)`. A persisted override wins over the derived default. Wormholes (`groupKey === 'wormhole'`) always return `null` — they are never classified or overridable, even if an `activityOverride` is set.

**Parameters:**
- `sig` — `{ name: string | null; groupKey: SignatureGroupKey | null; activityOverride?: SignatureActivity | null }` (accepts a `MapSignature`).

**Returns:** The effective activity, or `null` for no glyph.
