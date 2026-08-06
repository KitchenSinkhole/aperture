'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { Copy, Link2, Trash2 } from 'lucide-react';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createMapShare, listShares, revokeMapShare } from '@/app/(app)/actions/mapShares';
import type { MapShareListItem, SharePresenceMode } from '@/types';

const PRESENCE_OPTIONS: { value: SharePresenceMode; label: string; hint: string }[] = [
  { value: 'none', label: 'Hidden', hint: 'No pilot information at all.' },
  { value: 'anonymous', label: 'Counts only', hint: 'How many pilots per system, no names.' },
  { value: 'full', label: 'Named', hint: 'Pilot names and ships, as your members see them.' },
];
const PRESENCE_LABEL = Object.fromEntries(
  PRESENCE_OPTIONS.map((o) => [o.value, o.label]),
) as Record<SharePresenceMode, string>;

const EXPIRY_OPTIONS: { value: string; label: string; hours: number | null }[] = [
  { value: '6', label: '6 hours', hours: 6 },
  { value: '24', label: '24 hours', hours: 24 },
  { value: '168', label: '7 days', hours: 24 * 7 },
  { value: '720', label: '30 days', hours: 24 * 30 },
  { value: 'never', label: 'Never', hours: null },
];
const EXPIRY_LABELS = Object.fromEntries(EXPIRY_OPTIONS.map((o) => [o.value, o.label]));

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function shareUrl(token: string): string {
  return `${window.location.origin}/live/${token}`;
}

async function copyLink(token: string) {
  try {
    await navigator.clipboard.writeText(shareUrl(token));
    toast.success('Link copied.');
  } catch {
    toast.error('Could not copy — select the link and copy it manually.');
  }
}

/** The one-line summary of what a link exposes, for the list row. */
function describeProfile(share: MapShareListItem): string {
  const clauses = [`Pilots: ${PRESENCE_LABEL[share.presenceMode].toLowerCase()}`];
  if (share.showSignatures) clauses.push('signatures');
  if (share.showConnectionSigIds) clauses.push('hole sig IDs');
  if (share.showBubbles) clauses.push('bubbled ends');
  return clauses.join(' · ');
}

/**
 * Share-links editor for the in-map Settings → Share links tab. Mints, lists,
 * and revokes the public `/live/<token>` links for one map.
 */
export function MapSharePanel({ mapId }: { mapId: string }) {
  const [shares, setShares] = useState<MapShareListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const load = useCallback(() => {
    startTransition(async () => {
      const result = await listShares(mapId);
      if (result.ok) {
        setShares(result.data);
        setError(null);
      } else {
        setError(result.error);
      }
      setLoading(false);
    });
  }, [mapId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        A share link publishes a read-only view of this chain at an unguessable URL that needs no
        login. Intel notes, map notes, structures, system aliases, and who did what are never
        included. What a link exposes is fixed when you create it, so revoke and re-issue to change
        it.
      </p>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && !error && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!loading && !error && shares.length === 0 && (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          No share links. This map is not published anywhere.
        </p>
      )}

      {shares.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-muted-foreground">
                <th className="px-2 py-1.5 text-left font-medium">Label</th>
                <th className="px-2 py-1.5 text-left font-medium">Exposes</th>
                <th className="px-2 py-1.5 text-left font-medium">Expires</th>
                <th className="px-2 py-1.5 text-left font-medium">Created by</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {shares.map((share) => (
                <tr key={share.id} className="border-t border-foreground/10">
                  <td className="px-2 py-1.5 font-medium">
                    {share.label}
                    {share.expired && (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                        Expired
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground">{describeProfile(share)}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">
                    {share.expiresAt ? DATE_FORMAT.format(new Date(share.expiresAt)) : 'Never'}
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground">
                    {share.createdByName ?? 'Unknown'}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center justify-end gap-1">
                      {!share.expired && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Copy link for ${share.label}`}
                          onClick={() => void copyLink(share.token)}
                        >
                          <Copy />
                        </Button>
                      )}
                      <RevokeButton share={share} onRevoked={load} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateShareForm mapId={mapId} onCreated={load} />
    </div>
  );
}

function CreateShareForm({ mapId, onCreated }: { mapId: string; onCreated: () => void }) {
  const [label, setLabel] = useState('');
  const [presenceMode, setPresenceMode] = useState<SharePresenceMode>('anonymous');
  const [showSignatures, setShowSignatures] = useState(false);
  const [showConnectionSigIds, setShowConnectionSigIds] = useState(false);
  const [showBubbles, setShowBubbles] = useState(false);
  const [expiry, setExpiry] = useState('24');
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) {
      toast.error('Give the link a label so you can tell your links apart.');
      return;
    }
    startTransition(async () => {
      const result = await createMapShare({
        mapId,
        label: label.trim(),
        presenceMode,
        showSignatures,
        showConnectionSigIds,
        showBubbles,
        expiresInHours: EXPIRY_OPTIONS.find((o) => o.value === expiry)?.hours ?? null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setLabel('');
      onCreated();
      // The URL is the whole point of the action — hand it over without a
      // second click.
      await copyLink(result.data.token);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="text-sm font-medium">New share link</div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="share-label" className="text-sm">
          Label
        </label>
        <Input
          id="share-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={60}
          placeholder="e.g. Stream overlay"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="share-presence" className="text-sm">
            Pilots
          </label>
          <Select
            value={presenceMode}
            onValueChange={(v) => setPresenceMode(v as SharePresenceMode)}
          >
            <SelectTrigger id="share-presence">
              <SelectValue>{PRESENCE_LABEL[presenceMode]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {PRESENCE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {PRESENCE_OPTIONS.find((o) => o.value === presenceMode)?.hint}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="share-expiry" className="text-sm">
            Expires
          </label>
          <Select value={expiry} onValueChange={(v) => setExpiry(v as string)}>
            <SelectTrigger id="share-expiry">
              <SelectValue>{EXPIRY_LABELS[expiry]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {EXPIRY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <label className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="font-medium text-foreground">Show connection sig IDs</span>
          <span className="text-xs text-muted-foreground">
            The 3-character code at each end of a wormhole already on the map, so a guest can find
            their way in without re-scanning. Says nothing about signatures nobody has visited.
          </span>
        </div>
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={showConnectionSigIds}
          onChange={(e) => setShowConnectionSigIds(e.target.checked)}
          aria-label="Show connection sig IDs"
        />
      </label>

      <label className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="font-medium text-foreground">Show bubbled ends</span>
          <span className="text-xs text-muted-foreground">
            Which mouths of which holes your scouts have marked as bubbled. Useful to a guest flying
            the chain, but it also tells them where you have put your own bubbles.
          </span>
        </div>
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={showBubbles}
          onChange={(e) => setShowBubbles(e.target.checked)}
          aria-label="Show bubbled ends"
        />
      </label>

      <label className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="font-medium text-foreground">Show every signature</span>
          <span className="text-xs text-muted-foreground">
            The full scan list per system. Unscanned IDs advertise where you have not looked, so
            this is off unless you mean it.
          </span>
        </div>
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={showSignatures}
          onChange={(e) => setShowSignatures(e.target.checked)}
          aria-label="Show every signature"
        />
      </label>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          <Link2 />
          {pending ? 'Creating…' : 'Create link'}
        </Button>
      </div>
    </form>
  );
}

function RevokeButton({
  share,
  onRevoked,
}: {
  share: MapShareListItem;
  onRevoked: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const result = await revokeMapShare(share.id);
      if (result.ok) {
        toast.success('Share link revoked.');
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
            aria-label={`Revoke ${share.label}`}
            className="text-muted-foreground hover:text-destructive"
          />
        }
      >
        <Trash2 />
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Revoke “{share.label}”?</DialogTitle>
          <DialogDescription>
            The URL stops working and anyone watching it right now is disconnected. There is no way
            to bring this link back — create a new one to publish the chain again.
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
