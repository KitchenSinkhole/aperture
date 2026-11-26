## MapJumpToSystemDialog

**Purpose:** Experimental jump picker — rank on-map systems (`matchSystemsForFocus`: exact tag, then name/alias prefix) and center the canvas on the pick.
**File:** `src/components/map/MapJumpToSystemDialog.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| open | boolean | yes | Dialog open state |
| onOpenChange | (open: boolean) => void | yes | Open setter |
| systems | readonly MapSystemNode[] | yes | On-map systems to search |
| onJump | (mapSystemId: string) => void | yes | Pan + select the picked node |
