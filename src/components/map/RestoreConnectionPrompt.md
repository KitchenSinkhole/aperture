## RestoreConnectionPrompt

**Purpose:** Non-blocking, dismissible overlay offering to restore a dormant wormhole connection re-confirmed by a paste.
**File:** `src/components/map/RestoreConnectionPrompt.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| targetName | string | yes | Display name of the connection's far system (alias/name, or a fallback like the WH code / "wormhole" when the far system is itself hidden) |
| onConfirm | () => void | yes | Called when the operator confirms the restore |
| onDismiss | () => void | yes | Called when the operator dismisses (X) |

### Renders
A pinned shadcn `Card` (bottom-right) with the question "Restore connection to **{targetName}**?", a dismiss-X, and a constructive "Restore connection" button (`Unplug` icon, `secondary` variant).

### Behaviour & Interactions
- Mirrors `SubchainDeletePrompt`'s pattern but constructive rather than destructive. The rest of the UI stays interactive.
- Visibility is controlled by the parent (`MapCanvas` renders it only when `restoreConnPrompts[0]` is set). Pinned bottom-right to clear the subchain prompt (bottom-left) and the transit prompt (top-left).
