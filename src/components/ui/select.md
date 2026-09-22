## Select

**Purpose:** Single-select dropdown primitive (shadcn-style composition on `@base-ui/react/select`).
**File:** `src/components/ui/select.tsx`

### Exports
`Select` (Root), `SelectValue`, `SelectTrigger`, `SelectContent`, `SelectItem`, `SelectGroup`, `SelectGroupLabel`.

### Usage
```tsx
<Select value={scope} onValueChange={setScope} items={SCOPE_LABELS}>
  <SelectTrigger><SelectValue placeholder="Select scope" /></SelectTrigger>
  <SelectContent>
    {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
  </SelectContent>
</Select>
```

### Behaviour & Interactions
- `Select` is generic over the option value type; controlled via `value` / `onValueChange` (base-ui) or uncontrolled via `defaultValue`.
- Pass `items` (a `Record<value, ReactNode>` or array) on `Select` so `SelectValue` can render the chosen option's label.
- `SelectTrigger` shows a chevron; `SelectItem` shows a check `ItemIndicator` when selected. Popup is portalled and anchor-positioned (width matches the trigger via `--anchor-width`).
- `SelectContent` positions with `alignItemWithTrigger={false}` — the popup anchors below the trigger and flips/clamps to the viewport, rather than base-ui's default of overlaying the selected item on the trigger. This keeps long lists fully reachable and gives ordinary overflow (`max-h` + `overflow-y-auto`) wheel scrolling instead of scroll-arrow scrolling.
- `SelectItem`'s `ItemText` is `flex-1 min-w-0`, so item children fill the row width — a child with `flex justify-between` can push trailing content (e.g. a class/tag) to the right edge.
- `SelectGroup` wraps a run of items under a `SelectGroupLabel`, rendered as a small muted heading that is not itself selectable.
