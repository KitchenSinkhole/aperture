'use client';

import { useId, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  adminAddBlackoutClearance,
  adminEndBlackout,
  adminRemoveBlackoutClearance,
  adminStartBlackout,
} from '@/app/(admin)/actions/blackout';
import { Button } from '@/components/ui/button';
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
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { BlackoutClearance, BlackoutPanelData, BlackoutTitleOption } from '@/types';

type ActionResult = { ok: true } | { ok: false; error: string };
type ClearanceKind = BlackoutClearance['principalKind'];

// Fixed locale so server and client render identical text (avoids hydration mismatch).
const DATE_FORMAT = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

const KIND_LABELS: Record<ClearanceKind, string> = { character: 'Character', role: 'Corp title' };

/**
 * Global-admin card on `/admin/settings`: the instance-wide Blackout switch and
 * the cleared list of characters and corp titles who still see pilots.
 */
export function BlackoutPanel({ data }: { data: BlackoutPanelData }) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Blackout</h2>
        <p className="text-sm text-muted-foreground">
          Hides every tracked pilot&apos;s location from members, who still see their own
          characters. Tracked jumps stop adding systems and connections to maps. Global admins and
          the cleared list below keep seeing everyone.
        </p>
      </div>
      <BlackoutSwitch
        active={data.active}
        since={data.since}
        byCharacterName={data.byCharacterName}
      />
      <ClearedList clearances={data.clearances} />
      <AddClearance characters={data.characters} titles={data.titles} />
    </section>
  );
}

function useAction() {
  const [pending, startTransition] = useTransition();
  function run(action: () => Promise<ActionResult>, success: string, onDone?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(success);
        onDone?.();
      } else {
        toast.error(result.error);
      }
    });
  }
  return { pending, run };
}

function BlackoutSwitch({
  active,
  since,
  byCharacterName,
}: Pick<BlackoutPanelData, 'active' | 'since' | 'byCharacterName'>) {
  const { pending, run } = useAction();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <p className="text-sm">
        {active ? (
          <>
            <strong>On</strong>
            {since ? ` since ${DATE_FORMAT.format(new Date(since))}` : ''}
            {byCharacterName ? `, turned on by ${byCharacterName}` : ''}.
          </>
        ) : (
          <>
            <strong>Off.</strong> Members see every tracked pilot.
          </>
        )}
      </p>
      {active ? (
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => run(adminEndBlackout, 'Blackout turned off.')}
        >
          Turn off
        </Button>
      ) : (
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogTrigger render={<Button type="button" disabled={pending} />}>Turn on</DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Turn on Blackout?</DialogTitle>
              <DialogDescription>
                Members stop seeing other pilots on every map until an admin turns it off. Tracked
                jumps stop adding systems and connections. Global admins and the cleared list keep
                seeing everyone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="ghost" disabled={pending} />}>
                Cancel
              </DialogClose>
              <Button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(adminStartBlackout, 'Blackout is on.', () => setConfirmOpen(false))
                }
              >
                {pending ? 'Turning on…' : 'Turn on Blackout'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function ClearedList({ clearances }: { clearances: BlackoutClearance[] }) {
  const { pending, run } = useAction();

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Cleared list</h3>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Kind</th>
              <th className="px-3 py-2">Corp</th>
              <th className="px-3 py-2">Expires</th>
              <th className="px-3 py-2">Note</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {clearances.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-muted-foreground" colSpan={6}>
                  Nobody is on the cleared list. Global admins always see pilots.
                </td>
              </tr>
            ) : (
              clearances.map((c) => {
                const label = c.name ?? `Unknown ${KIND_LABELS[c.principalKind].toLowerCase()}`;
                return (
                  <tr key={c.grantId} className="border-t border-border">
                    <td className="px-3 py-2">{label}</td>
                    <td className="px-3 py-2 text-xs">{KIND_LABELS[c.principalKind]}</td>
                    <td className="px-3 py-2 text-xs">{c.corporationName ?? ''}</td>
                    <td className="px-3 py-2 text-xs">
                      {c.expiresAt ? DATE_FORMAT.format(new Date(c.expiresAt)) : 'Never'}
                      {c.expired && <span className="ml-1 text-muted-foreground">(expired)</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{c.note ?? ''}</td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        aria-label={`Remove ${label} from the cleared list`}
                        onClick={() =>
                          run(() => adminRemoveBlackoutClearance(c.grantId), 'Removed.')
                        }
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AddClearance({
  characters,
  titles,
}: Pick<BlackoutPanelData, 'characters' | 'titles'>) {
  const { pending, run } = useAction();
  const [kind, setKind] = useState<ClearanceKind>('character');
  const [characterName, setCharacterName] = useState('');
  const [corporationId, setCorporationId] = useState<string | null>(null);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState('');
  const [note, setNote] = useState('');
  const characterListId = useId();

  const corporations = useMemo(() => corporationsOf(titles), [titles]);
  const corpTitles = titles.filter((t) => t.corporationId === corporationId);

  function add() {
    let principalId: string | undefined;
    if (kind === 'character') {
      const needle = characterName.trim().toLowerCase();
      principalId = characters.find((c) => c.name.toLowerCase() === needle)?.id;
      if (!principalId) {
        toast.error('Pick a character from the list.');
        return;
      }
    } else {
      if (!roleId) {
        toast.error('Pick a corp title.');
        return;
      }
      principalId = roleId;
    }

    // datetime-local is the viewer's local time; send the instant it names.
    let expiry = '';
    if (expiresAt !== '') {
      const d = new Date(expiresAt);
      if (Number.isNaN(d.getTime())) {
        toast.error('Invalid expiry date.');
        return;
      }
      expiry = d.toISOString();
    }

    run(
      () =>
        adminAddBlackoutClearance({ principalKind: kind, principalId, expiresAt: expiry, note }),
      'Added to the cleared list.',
      () => {
        setCharacterName('');
        setRoleId(null);
        setExpiresAt('');
        setNote('');
      },
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Add to the cleared list</h3>
      <div className="flex flex-wrap items-end gap-2">
        <Select
          value={kind}
          items={KIND_LABELS}
          onValueChange={(v) => setKind(v as ClearanceKind)}
        >
          <SelectTrigger className="w-36" aria-label="Kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="character">Character</SelectItem>
            <SelectItem value="role">Corp title</SelectItem>
          </SelectContent>
        </Select>

        {kind === 'character' ? (
          <>
            <Input
              className="w-56"
              list={characterListId}
              placeholder="Character name"
              aria-label="Character name"
              value={characterName}
              onChange={(e) => setCharacterName(e.target.value)}
              disabled={pending}
            />
            <datalist id={characterListId}>
              {characters.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </>
        ) : corporations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No corp titles known yet. Titles appear as their holders sign in.
          </p>
        ) : (
          <>
            <Select
              value={corporationId}
              items={Object.fromEntries(corporations.map((c) => [c.id, c.name]))}
              onValueChange={(v) => {
                setCorporationId(v as string);
                setRoleId(null);
              }}
            >
              <SelectTrigger className="w-48" aria-label="Corporation">
                <SelectValue placeholder="Corporation" />
              </SelectTrigger>
              <SelectContent>
                {corporations.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={roleId}
              items={Object.fromEntries(corpTitles.map((t) => [t.roleId, t.label]))}
              onValueChange={(v) => setRoleId(v as string)}
              disabled={corporationId === null}
            >
              <SelectTrigger className="w-48" aria-label="Title">
                <SelectValue placeholder="Title" />
              </SelectTrigger>
              <SelectContent>
                {corpTitles.map((t) => (
                  <SelectItem key={t.roleId} value={t.roleId}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Expires (optional)
          <Input
            className="w-52"
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            disabled={pending}
          />
        </label>
        <Input
          className="w-44"
          placeholder="Note (optional)"
          aria-label="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={pending}
        />
        <Button type="button" onClick={add} disabled={pending}>
          Add
        </Button>
      </div>
    </div>
  );
}

function corporationsOf(titles: BlackoutTitleOption[]): { id: string; name: string }[] {
  const byId = new Map<string, string>();
  for (const t of titles) byId.set(t.corporationId, t.corporationName);
  return [...byId].map(([id, name]) => ({ id, name }));
}
