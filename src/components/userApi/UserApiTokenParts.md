## UserApiTokenParts

**Purpose:** Pieces shared by every user API token list (the Map Settings API tab and Account Settings): date and status wording, the account block banner, and the revoke button.
**File:** `src/components/userApi/UserApiTokenParts.tsx`

---

### formatUserApiDate(iso: string | null, fallback: string): string
A list's date and time, or `fallback` when `iso` is null.

### describeUserApiTokenStatus(token: UserApiTokenListItem): string
The status column's words: Active, Suspended until …, Expired, Map deleted, API off on this map, Owner lost access, Owner's account blocked.

---

## UserApiBlockBanner

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| block | UserApiAccountBlock | yes | The signed-in account's standing block |

### Renders
A destructive alert (`role="alert"`): API access is blocked until the block's end, or "until an admin lifts it" for an indefinite block; the reason when there is one; and that tokens do not work and none can be created while it stands.

---

## UserApiRevokeButton

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| token | UserApiTokenListItem | yes | The token to revoke |
| onRevoked | () => void | yes | Called after a successful revoke |

### Renders
A trash icon button opening a confirm dialog that names the token and states that a revoked token cannot be restored.

### Behaviour & Interactions
- Confirming calls `revokeMapApiToken(token.id)`; success toasts, closes the dialog and calls `onRevoked`; failure toasts the error and leaves the dialog open.

### Depends On
- `revokeMapApiToken` (`src/app/(app)/actions/mapApi.ts`); `Dialog`, `Button` (`@/components/ui/*`); `sonner` toast.
