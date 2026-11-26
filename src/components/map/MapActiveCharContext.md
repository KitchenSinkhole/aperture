## MapActiveCharContext

**Purpose:** Provides the active character from the viewer's roster for route planning and UI elements that need to know the player's current in-game location.
**File:** `src/components/map/MapActiveCharContext.tsx`

---

### MapActiveCharProvider

Context provider that tracks which of the viewer's characters is active based on presence data.

**Props:**
- `viewerCharacters` — array of `{ id: number; name: string }` representing the viewer's roster
- `mainCharacterId` — the account's primary character id (may be null)
- `children` — React nodes

**Behaviour:**
- Caches a set of viewer character IDs to filter the presence roster
- Builds a `locatedByChar` map of character ID → system ID from the presence data
- Maintains `pickedCharId` state: user's manual selection via `setPickedCharId()`
- Falls back cascade: picked char (if located) → main char (if located) → first located char → null
- Exposes `locatedChars`: only characters that appear in presence (have a known system)

---

### useMapActiveChar(): MapActiveCharContextValue

Returns the active character context. Throws if called outside `MapActiveCharProvider`.

**Returns:**
```typescript
{
  activeCharId: number | null;              // The resolved active character id
  activeCharSystemId: number | null;        // The system that character is in (or null)
  pickedCharId: number | null;              // Manual pilots-panel pick when set
  locatedChars: { id: number; name: string }[];  // Characters with a known location
  setPickedCharId: (id: number | null) => void;  // Manual picker override
}
```
