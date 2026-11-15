## experimentalManualMass.ts

**Purpose:** Tracks connection ids whose link mass was set manually so auto-mass from jump log does not overwrite them in the same session.
**File:** `src/lib/experimentalManualMass.ts`

---

### lockManualConnectionMass(connectionId: string): void
Marks a connection as manually controlled for mass.

---

### isManualConnectionMassLocked(connectionId: string): boolean
Whether auto-mass must skip this connection.

---

### clearManualConnectionMassLock(connectionId: string): void
Removes the lock (e.g. when the connection is deleted).