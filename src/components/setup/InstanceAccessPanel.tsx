'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  setupAddGrant,
  setupAddOwner,
  setupRemoveGrant,
  setupRemoveOwner,
  setupSetAccessMode,
} from '@/app/(setup)/actions';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Serialized shapes the setup page passes down. EVE ids and dates cross the
 * server/client boundary as strings.
 */
export interface SerializedOwner {
  principalKind: 'corporation' | 'alliance';
  principalId: string;
}

export interface SerializedGrant {
  id: string;
  principalKind: 'character' | 'corporation' | 'alliance' | 'role';
  principalId: string;
  capability: 'login' | 'admin';
  expiresAt: string | null;
  note: string | null;
}

export interface SerializedInstanceConfig {
  accessMode: 'open' | 'restricted';
  updatedAt: string | null;
  owners: SerializedOwner[];
  grants: SerializedGrant[];
}

type ActionResult = { ok: true } | { ok: false; error: string };

// Fixed locale so server and client render identical text (avoids hydration mismatch).
const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function InstanceAccessPanel({ config }: { config: SerializedInstanceConfig }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-lg font-semibold tracking-tight">Instance access</h2>
      <p className="text-sm text-muted-foreground">
        Gate who can sign in. <code>restricted</code> admits only owner-entity members and
        allowlisted principals; <code>open</code> admits any EVE login. Ownership lets members log
        in but does not grant admin — super-admin comes only from an explicit <code>admin</code>{' '}
        grant.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <AccessModeCard mode={config.accessMode} updatedAt={config.updatedAt} />
        <OwnersCard owners={config.owners} />
      </div>
      <GrantsCard grants={config.grants} />
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

function AccessModeCard({ mode, updatedAt }: { mode: 'open' | 'restricted'; updatedAt: string | null }) {
  const { pending, run } = useAction();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Access mode</CardTitle>
        <CardDescription>
          Currently <strong>{mode}</strong>
          {updatedAt ? ` · updated ${DATE_FORMAT.format(new Date(updatedAt))}` : ' · never set'}.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex gap-2">
        <Button
          type="button"
          variant={mode === 'restricted' ? 'default' : 'outline'}
          disabled={pending || mode === 'restricted'}
          onClick={() => run(() => setupSetAccessMode('restricted'), 'Access mode: restricted.')}
        >
          Restricted
        </Button>
        <Button
          type="button"
          variant={mode === 'open' ? 'default' : 'outline'}
          disabled={pending || mode === 'open'}
          onClick={() => run(() => setupSetAccessMode('open'), 'Access mode: open.')}
        >
          Open
        </Button>
      </CardContent>
    </Card>
  );
}

function OwnersCard({ owners }: { owners: SerializedOwner[] }) {
  const { pending, run } = useAction();
  const [kind, setKind] = useState<'corporation' | 'alliance'>('corporation');
  const [id, setId] = useState('');

  function add() {
    if (id.trim() === '') {
      toast.error('Enter a corporation or alliance id.');
      return;
    }
    run(() => setupAddOwner(kind, id.trim()), 'Owner added.', () => setId(''));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Owner entities</CardTitle>
        <CardDescription>
          Corp/alliance that owns this deployment. Members may always log in.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col gap-1 text-sm">
          {owners.length === 0 ? (
            <li className="text-muted-foreground">No owners designated.</li>
          ) : (
            owners.map((o) => (
              <li
                key={`${o.principalKind}:${o.principalId}`}
                className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1"
              >
                <span className="font-mono text-xs">
                  {o.principalKind} {o.principalId}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    run(() => setupRemoveOwner(o.principalKind, o.principalId), 'Owner removed.')
                  }
                >
                  Remove
                </Button>
              </li>
            ))
          )}
        </ul>
        <div className="flex flex-wrap items-end gap-2">
          <Select value={kind} onValueChange={(v) => setKind(v as 'corporation' | 'alliance')}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="corporation">Corporation</SelectItem>
              <SelectItem value="alliance">Alliance</SelectItem>
            </SelectContent>
          </Select>
          <Input
            className="w-40"
            inputMode="numeric"
            placeholder="EVE id"
            value={id}
            onChange={(e) => setId(e.target.value)}
            disabled={pending}
          />
          <Button type="button" onClick={add} disabled={pending}>
            Add owner
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const CAPABILITY_HINT: Record<SerializedGrant['capability'], string> = {
  login: 'allowlist',
  admin: 'super-admin',
};

function GrantsCard({ grants }: { grants: SerializedGrant[] }) {
  const { pending, run } = useAction();
  const [principalKind, setPrincipalKind] =
    useState<SerializedGrant['principalKind']>('character');
  const [principalId, setPrincipalId] = useState('');
  const [capability, setCapability] = useState<SerializedGrant['capability']>('login');
  const [expiresAt, setExpiresAt] = useState('');
  const [note, setNote] = useState('');

  function add() {
    if (principalId.trim() === '') {
      toast.error('Enter the principal id.');
      return;
    }
    run(
      () =>
        setupAddGrant({
          principalKind,
          principalId: principalId.trim(),
          capability,
          expiresAt,
          note,
        }),
      'Grant added.',
      () => {
        setPrincipalId('');
        setExpiresAt('');
        setNote('');
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Allowlist &amp; grants</CardTitle>
        <CardDescription>
          Instance-scoped grants. <code>login</code> = allowlist entry; <code>admin</code> =
          super-admin. A character/corp/alliance/role principal id is required. Leave expiry
          empty for a permanent grant.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Principal</th>
                <th className="px-3 py-2">Capability</th>
                <th className="px-3 py-2">Expires</th>
                <th className="px-3 py-2">Note</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {grants.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-muted-foreground" colSpan={5}>
                    No grants. On a restricted instance with no owners, the first sign-in becomes
                    the bootstrap admin.
                  </td>
                </tr>
              ) : (
                grants.map((g) => (
                  <tr key={g.id} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs">
                      {g.principalKind} {g.principalId}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {g.capability}{' '}
                      <span className="text-muted-foreground">({CAPABILITY_HINT[g.capability]})</span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {g.expiresAt ? DATE_FORMAT.format(new Date(g.expiresAt)) : 'permanent'}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{g.note ?? '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => run(() => setupRemoveGrant(g.id), 'Grant revoked.')}
                      >
                        Revoke
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <Select
            value={principalKind}
            onValueChange={(v) => setPrincipalKind(v as SerializedGrant['principalKind'])}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="character">Character</SelectItem>
              <SelectItem value="corporation">Corporation</SelectItem>
              <SelectItem value="alliance">Alliance</SelectItem>
              <SelectItem value="role">Role</SelectItem>
            </SelectContent>
          </Select>
          <Input
            className="w-40"
            inputMode="numeric"
            placeholder="Principal id"
            value={principalId}
            onChange={(e) => setPrincipalId(e.target.value)}
            disabled={pending}
          />
          <Select
            value={capability}
            onValueChange={(v) => setCapability(v as SerializedGrant['capability'])}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="login">login</SelectItem>
              <SelectItem value="admin">admin</SelectItem>
            </SelectContent>
          </Select>
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
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={pending}
          />
          <Button type="button" onClick={add} disabled={pending}>
            Add grant
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
