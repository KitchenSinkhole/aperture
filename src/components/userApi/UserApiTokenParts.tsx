'use client';

import { useState, useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { revokeMapApiToken } from '@/app/(app)/actions/mapApi';
import type { UserApiAccountBlock, UserApiTokenListItem } from '@/types';

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** A token list's date, or `fallback` when there is none. */
export function formatUserApiDate(iso: string | null, fallback: string): string {
  return iso ? DATE_FORMAT.format(new Date(iso)) : fallback;
}

/** A token's computed status as a list reads it. */
export function describeUserApiTokenStatus(token: UserApiTokenListItem): string {
  switch (token.status) {
    case 'active':
      return 'Active';
    case 'suspended':
      return `Suspended until ${formatUserApiDate(token.suspendedUntil, 'later')}`;
    case 'expired':
      return 'Expired';
    case 'map_deleted':
      return 'Map deleted';
    case 'api_disabled':
      return 'API off on this map';
    case 'lost_access':
      return 'Owner lost access';
    case 'blocked':
      return "Owner's account blocked";
  }
}

/** The signed-in account's user API block: its end (or that only an admin lifts it) and its reason. */
export function UserApiBlockBanner({ block }: { block: UserApiAccountBlock }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
    >
      <p className="font-medium">
        API access is blocked for your account{' '}
        {block.until ? `until ${formatUserApiDate(block.until, '')}` : 'until an admin lifts it'}.
      </p>
      {block.reason && <p className="text-muted-foreground">{block.reason}</p>}
      <p className="text-muted-foreground">
        Your tokens do not work and you cannot create new ones while the block stands.
      </p>
    </div>
  );
}

/** A trash button that confirms, then revokes one token and calls `onRevoked`. */
export function UserApiRevokeButton({
  token,
  onRevoked,
}: {
  token: UserApiTokenListItem;
  onRevoked: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const result = await revokeMapApiToken(token.id);
      if (result.ok) {
        toast.success('Token revoked.');
        setOpen(false);
        onRevoked();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Revoke ${token.label}`}
            className="text-muted-foreground hover:text-destructive"
          />
        }
      >
        <Trash2 />
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Revoke “{token.label}”?</DialogTitle>
          <DialogDescription>
            Any tool using this token is refused from its next request. A revoked token cannot be
            restored.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="ghost" disabled={pending} />}>
            Cancel
          </DialogClose>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending ? 'Revoking…' : 'Revoke'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
