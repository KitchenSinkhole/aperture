## CreateMapDialog

**Purpose:** "New map" button that opens a modal to create a map (name + scope + visibility) via `createMapAction`.
**File:** `src/components/maps/CreateMapDialog.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| canCreateCorp | boolean | yes | Whether the viewer may create a corporation map (`canCreateMap(actor, 'corp')`) |
| canCreateAlliance | boolean | yes | Whether the viewer may create an alliance map (`canCreateMap(actor, 'alliance')`) |

### Renders
A primary `Button` trigger ("New map") opening a `Dialog` with a name `Input` and two `Select`s (scope, visibility) plus Cancel / Create actions.

### Behaviour & Interactions
- Client component. Local state for `name` / `scope` (default `wh`) / `type` (default `private`).
- Submit calls `createMapAction({ name, scope, type })` inside `useTransition`; on success: success toast, reset fields, close dialog (the action's `revalidatePath('/maps')` refreshes the list). On error: `toast.error(result.error)`.
- Scope/type option lists are hardcoded here (mirrors the `map_scope` / `map_type` enums) to avoid pulling the Drizzle schema into the client bundle.
- A visibility the viewer lacks is a disabled option carrying its requirement inline ("Directors only" / "Executor-corp Directors only"); the reason sits on the item rather than in a tooltip because a disabled option takes no pointer events. A muted line under the selects restates which visibilities are out of reach. `private` is always selectable and is the default, so the form is never dead-ended.
- The disabled options mirror the server gate; `createMapAction` remains the authority and answers a denied type with a message naming that type's requirement.

### Emits / Calls
- `createMapAction` (`@/app/(app)/actions/map`).

### Depends On
- `Dialog`, `Input`, `Select`, `Button` UI primitives; `sonner` toasts.
