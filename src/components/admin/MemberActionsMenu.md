## MemberActionsMenu

**Purpose:** Client island rendered inside each `/admin/members` row. Surfaces kick/ban/activate moderation controls and the account's user API block and lift (admin-only — the whole `/admin` console is gated on `isAdmin`).
**File:** `src/components/admin/MemberActionsMenu.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| member | AdminMemberRow | yes | Row from `listAdminMembers` (`@/lib/auth/members`) — drives both the displayed controls and the optimistic strings in the toast. |

### Renders
A right-aligned row of small icon buttons. The visible set depends on `member.status`:
- Active row: three timed-kick presets (`5m` / `1h` / `24h`) + a ban icon button.
- Kicked or banned row: one **Activate** button.
- Then, on every row: a "Block API access" icon button while the account has no API block, or a **Lift API block** button while it has one.

### Behaviour & Interactions
- Each action wraps `useTransition` and toasts the result via `sonner`. Failures show the server-side error verbatim.
- Kick presets are single-click — no confirmation, the 5/60/1440-minute cap makes the action low-blast-radius and `Activate` undoes it.
- Ban opens a `Dialog` that requires a non-empty reason (1-500 chars). Cancelling resets the textarea.
- Block API access opens the same kind of reason-required dialog, stating that the block covers every character on the account and lasts until an admin lifts it. Lift is single-click.

### Calls
- `adminKickCharacter(id, minutes)` — `@/app/(admin)/actions/members`.
- `adminBanCharacter(id, reason)` — same.
- `adminActivateCharacter(id)` — same.
- `adminBlockUserApi(id, reason)`, `adminLiftUserApiBlock(id)` — same.

### Depends on
- `Button`, `Dialog*`, `Input` — `@/components/ui/*`.
- `AdminMemberRow` — `@/lib/auth/members`.

### Notes
- No bulk-select / multi-row controls — per-row only.
- The grant/revoke-manager toggle was removed in the Stage-4 teardown — `authz_level` is `member | admin` and admin is hand-granted from `/setup`, not toggled here.
