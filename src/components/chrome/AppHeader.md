## AppHeader

**Purpose:** Top page chrome for the authenticated app — branding link plus the Characters panel.
**File:** `src/components/chrome/AppHeader.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| active | `{ id: string; name: string }` | yes | Identity character (account main), forwarded to the panel chip |
| characters | `PanelCharacter[]` | yes | Account roster (incl. `authzLevel`), forwarded to the panel |
| mainCharacterId | `string \| null` | yes | The account's main, forwarded to the panel |
| travelAnimation | boolean | yes | The account's connection-travel-animation toggle, forwarded to the panel |
| signatureIndicators | SignatureIndicatorAccountSettings | yes | The account's signature-indicator settings, forwarded to the panel |

### Renders
A compact (`h-9`) full-width bordered header bar with no max-width cap: on the left, the Aperture logo image followed by the "Aperture" text as a link to `/maps`, with the `VersionChip` immediately beside it (reads as "Aperture v1.0.0-…"); on the right, the `StatisticsButton` and `ReferenceMenu` info menu next to the `CharacterPanel`.

### Behaviour & Interactions
- Async server component. Fetches the cached changelog releases (`fetchChangelogReleases`) and passes them to `VersionChip`. A fetch failure is swallowed (empty array) so a GitHub outage never breaks the header.
- App version is read directly from `package.json` (same pattern as `AppFooter`).

### Depends On
- `VersionChip` (client) — version label + changelog entry point.
- `CharacterPanel` (client) — the data props are resolved server-side in `(app)/layout.tsx`.
- `ReferenceMenu` (client) — header entry point for the static reference dialogs.
- `StatisticsButton` (client) — launches the Statistics dialog.
- `fetchChangelogReleases` — `@/lib/integrations/github` (server-side, cached).
