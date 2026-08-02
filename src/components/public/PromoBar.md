## PromoBar

**Purpose:** The spectator view's top bar — the Aperture mark, the map's name, and the two outbound links.
**File:** `src/components/public/PromoBar.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| mapName | string | yes | The shared map's name. |
| shareLabel | string | yes | The share token's operator-set label. |

### Renders
A slim bordered header: a pulsing live dot beside the `APERTURE` wordmark, then the map name with the share label beside it, then `Open Aperture` (the deployment root) and `Source` (`apertureConfig.PUBLIC_LINKS.repo`, opened in a new tab) pushed right.

### Behaviour & Interactions
- The live dot's pulse is suppressed under reduced-motion.
- A server component — nothing here is interactive beyond the links.

### Depends On
- `aperture.config` (`PUBLIC_LINKS.repo`)
