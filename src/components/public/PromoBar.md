## PromoBar

**Purpose:** The spectator view's top bar — the Aperture mark, the map's name, and the three outbound links.
**File:** `src/components/public/PromoBar.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| mapName | string | yes | The shared map's name. |
| shareLabel | string | yes | The share token's operator-set label. |

### Renders
A slim bordered header: the Aperture logo beside the `APERTURE` wordmark, then the map name with the share label beside it, then pushed right: `Discord` and `Source` as text links (`apertureConfig.PUBLIC_LINKS.discord` / `.repo`), and `What is Aperture?` (`PUBLIC_LINKS.website`, the project's landing page) as a bordered button, the page's one primary action. All three open in a new tab.

### Behaviour & Interactions
- Pure identity — no liveness indicator here; the footer's feed indicator is the page's sole liveness signal.
- A server component — nothing here is interactive beyond the links.

### Depends On
- `aperture.config` (`PUBLIC_LINKS.repo`, `PUBLIC_LINKS.discord`, `PUBLIC_LINKS.website`)
