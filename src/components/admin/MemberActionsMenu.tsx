'use client';

import { useState, useTransition } from 'react';
import { Ban, KeyRound, LockOpen, Timer, UserCheck } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import {
  adminActivateCharacter,
  adminBanCharacter,
  adminBlockUserApi,
  adminKickCharacter,
  adminLiftUserApiBlock,
} from '@/app/(admin)/actions/members';
import type { AdminMemberRow } from '@/lib/auth/members';

type KickMinutes = 5 | 60 | 1440;

const KICK_PRESETS: { minutes: KickMinutes; label: string; aria: string }[] = [
  { minutes: 5, label: '5m', aria: 'Kick for 5 minutes' },
  { minutes: 60, label: '1h', aria: 'Kick for 1 hour' },
  { minutes: 1440, label: '24h', aria: 'Kick for 24 hours' },
];

export function MemberActionsMenu({ member }: { member: AdminMemberRow }) {
  const moderated = member.status !== 'active';

  return (
    <div className="flex items-center justify-end gap-1">
      {moderated ? (
        <ActivateButton member={member} />
      ) : (
        <>
          {KICK_PRESETS.map((p) => (
            <KickButton key={p.minutes} member={member} preset={p} />
          ))}
          <BanButton member={member} />
        </>
      )}
      {member.apiBlock === null ? (
        <BlockApiButton member={member} />
      ) : (
        <LiftApiBlockButton member={member} />
      )}
    </div>
  );
}

function KickButton({
  member,
  preset,
}: {
  member: AdminMemberRow;
  preset: { minutes: KickMinutes; label: string; aria: string };
}) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const result = await adminKickCharacter(member.id, preset.minutes);
      if (result.ok) toast.success(`${member.name} kicked for ${preset.label}.`);
      else toast.error(result.error);
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={`${preset.aria} — ${member.name}`}
      onClick={onClick}
      disabled={pending}
      className="text-muted-foreground hover:text-foreground"
    >
      <Timer className="size-3.5" />
      <span className="text-xs">{preset.label}</span>
    </Button>
  );
}

function BanButton({ member }: { member: AdminMemberRow }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const enabled = reason.trim().length > 0 && !pending;

  function onConfirm() {
    if (!enabled) return;
    startTransition(async () => {
      const result = await adminBanCharacter(member.id, reason.trim());
      if (result.ok) {
        toast.success(`${member.name} banned.`);
        setOpen(false);
        setReason('');
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setReason('');
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Ban ${member.name}`}
            className="text-muted-foreground hover:text-destructive"
          />
        }
      >
        <Ban />
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Ban {member.name}?</DialogTitle>
          <DialogDescription>
            Bans are permanent — the <code>character-cleanup</code> cron never lifts them.
            Use <em>activate</em> to undo. Provide a reason that future operators can
            audit.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason"
          aria-label="Ban reason"
          maxLength={500}
        />
        <DialogFooter>
          <DialogClose
            render={<Button type="button" variant="ghost" disabled={pending} />}
          >
            Cancel
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={!enabled}
          >
            {pending ? 'Banning…' : 'Ban'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActivateButton({ member }: { member: AdminMemberRow }) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const result = await adminActivateCharacter(member.id);
      if (result.ok) toast.success(`${member.name} activated.`);
      else toast.error(result.error);
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={`Activate ${member.name}`}
      onClick={onClick}
      disabled={pending}
      className="text-muted-foreground hover:text-foreground"
    >
      <UserCheck className="size-3.5" />
      <span className="text-xs">Activate</span>
    </Button>
  );
}

function BlockApiButton({ member }: { member: AdminMemberRow }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const enabled = reason.trim().length > 0 && !pending;

  function onConfirm() {
    if (!enabled) return;
    startTransition(async () => {
      const result = await adminBlockUserApi(member.id, reason.trim());
      if (result.ok) {
        toast.success(`API access blocked for ${member.name}'s account.`);
        setOpen(false);
        setReason('');
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setReason('');
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Block API access for ${member.name}`}
            title="Block API access"
            className="text-muted-foreground hover:text-destructive"
          />
        }
      >
        <KeyRound />
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Block API access for {member.name}?</DialogTitle>
          <DialogDescription>
            Covers every character on this account. Its API tokens stop working and it cannot
            create new ones until an admin lifts the block. The account sees the reason.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason"
          aria-label="API block reason"
          maxLength={500}
        />
        <DialogFooter>
          <DialogClose
            render={<Button type="button" variant="ghost" disabled={pending} />}
          >
            Cancel
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={!enabled}
          >
            {pending ? 'Blocking…' : 'Block API access'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LiftApiBlockButton({ member }: { member: AdminMemberRow }) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const result = await adminLiftUserApiBlock(member.id);
      if (result.ok) toast.success(`API block lifted for ${member.name}'s account.`);
      else toast.error(result.error);
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={`Lift API block for ${member.name}`}
      onClick={onClick}
      disabled={pending}
      className="text-muted-foreground hover:text-foreground"
    >
      <LockOpen className="size-3.5" />
      <span className="text-xs">Lift API block</span>
    </Button>
  );
}
