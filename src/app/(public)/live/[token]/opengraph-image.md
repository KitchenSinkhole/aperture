## opengraph-image.tsx

**Purpose:** The unfurl card a share link renders in chat and on forums — the actual chain, drawn as a constellation of security-coloured systems.
**File:** `src/app/(public)/live/[token]/opengraph-image.tsx`

---

### default export: OpenGraphImage({ params })
Returns a 1200×630 PNG `ImageResponse`. Reads the same cached snapshot the page does, so a card costs no extra query. A token that does not resolve renders a plain branded fallback rather than an error, so a revoked link still unfurls as Aperture.

Runs on the Node runtime, matching the rest of the route (the app serves from a custom Node server).

**Exports:** `runtime`, `size`, `contentType`, `alt` — the App Router's image-metadata conventions.

### Layout
Two columns. Left is an identity panel: live dot and `APERTURE` wordmark, the map name, the system / connection / entrance counts stacked one per line, and the tagline at its foot. Right is the chain. Because the two are side by side, a long map name cannot run into the chain however far it wraps.

The chain box is near-square, matching the proportions of an authored chain; a wide letterbox would scale a square chain down to fit its height and strand it in empty space. The chain scales the map's authored positions into that box preserving aspect ratio, never enlarging past 1:1 so a two-system chain doesn't blow up to fill the frame, and whatever the scale leaves over is centred. A map whose systems are spread far apart renders sparse, since the framing is faithful to the authored positions rather than cropped to the densest cluster.

Systems render as small rounded squares tinted by `systemClassColor`, the palette the canvas tiles use, so the card and the page agree on what an `H` looks like. Connections are thin rotated bars between system centres, which keeps the whole card in flex-box primitives rather than SVG.

### Fonts
Geist Mono SemiBold is read from `public/fonts/GeistMono-SemiBold.ttf` at render. `next/font/google` yields no font buffer, and vendoring the file avoids a per-render fetch to an external host.

### Depends On
- `getPublicSnapshot` (`src/lib/map/publicSnapshot.ts`)
- `systemClassColor` (`src/components/map/styling.ts`), `NODE_WIDTH` / `NODE_HEIGHT` (`src/lib/map/placement.ts`)
- `next/og` (`ImageResponse`)
