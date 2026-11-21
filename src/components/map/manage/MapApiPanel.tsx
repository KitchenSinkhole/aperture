'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { BookOpen, Copy, KeyRound, Save } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import {
  UserApiBlockBanner,
  UserApiRevokeButton,
  describeUserApiTokenStatus,
  formatUserApiDate,
} from '@/components/userApi/UserApiTokenParts';
import {
  createMapApiToken,
  getMapApiState,
  updateMapApiSettings,
} from '@/app/(app)/actions/mapApi';
import type { ApiScope, MapApiState, UserApiTokenListItem } from '@/types';
import { apertureConfig } from '../../../../aperture.config';

const API_REFERENCE_URL = `https://github.com/${apertureConfig.GITHUB_CHANGELOG_REPO}/blob/master/docs/reference/user-api.md`;

const SCOPES: { scope: ApiScope; label: string; description: string }[] = [
  {
    scope: 'map',
    label: 'Map',
    description: 'The systems on the map and the connections between them.',
  },
  {
    scope: 'signatures',
    label: 'Signatures',
    description: 'Every signature in the systems on the map.',
  },
  {
    scope: 'pilots',
    label: 'Pilots',
    description: 'Online tracked pilots and where they are, including pilot names and ships.',
  },
  { scope: 'notes', label: 'Notes', description: 'Map notes and the intel notes on each system.' },
  {
    scope: 'mass_log',
    label: 'Mass log',
    description: 'Every logged jump through current connections, including pilot names and ships.',
  },
  { scope: 'kills', label: 'Kills', description: 'Recent kills in the systems on the map.' },
];
const SCOPE_LABEL = Object.fromEntries(SCOPES.map((s) => [s.scope, s.label])) as Record<
  ApiScope,
  string
>;

const EXPIRY_OPTIONS: { value: string; label: string; days: number | null }[] = [
  { value: '30', label: '30 days', days: 30 },
  { value: '90', label: '90 days', days: 90 },
  { value: '365', label: '1 year', days: 365 },
  { value: 'never', label: 'Never', days: null },
];
const EXPIRY_LABELS = Object.fromEntries(EXPIRY_OPTIONS.map((o) => [o.value, o.label]));

function describeScopes(scopes: ApiScope[]): string {
  return scopes.map((s) => SCOPE_LABEL[s]).join(', ');
}

/**
 * The in-map Settings → API tab: the map's API switch and scopes for a holder
 * of `api_manage`, every token on the map for them, and the viewer's own
 * tokens with a mint form for everyone.
 */
export function MapApiPanel({
  mapId,
  apiEnabled,
  apiScopes,
}: {
  mapId: string;
  apiEnabled: boolean;
  apiScopes: ApiScope[];
}) {
  const [state, setState] = useState<MapApiState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const load = useCallback(() => {
    startTransition(async () => {
      const result = await getMapApiState(mapId);
      if (result.ok) {
        setState(result.data);
        setError(null);
      } else {
        setError(result.error);
      }
    });
  }, [mapId]);

  const liveScopesKey = apiScopes.join(',');
  useEffect(() => {
    load();
  }, [load, apiEnabled, liveScopesKey]);

  // The reveal sits outside the error and loading branches, so a reload that
  // fails right after a mint cannot unmount the only copy of the raw token.
  const reveal = <RevealDialog token={revealed} onClose={() => setRevealed(null)} />;
  if (error || !state) {
    return (
      <>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
        {reveal}
      </>
    );
  }

  const liveOnMap = state.ownTokens.filter((t) => t.status !== 'expired').length;
  const mintBlocker = !state.instanceEnabled
    ? 'The API is turned off on this instance.'
    : state.block
      ? 'Your account cannot create tokens while it is blocked.'
      : !apiEnabled
        ? 'The API is turned off on this map.'
        : apiScopes.length === 0
          ? 'This map does not expose any data yet.'
          : liveOnMap >= state.limits.perMap
            ? `You have ${state.limits.perMap} live tokens on this map. Revoke one to create another.`
            : state.limits.liveOnAccount >= state.limits.perAccount
              ? `Your account has ${state.limits.perAccount} live tokens. Revoke one to create another.`
              : null;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        API tokens let your own tools read this map. A token is read-only, sees exactly what you
        see, and stops working if you lose access to the map.{' '}
        <a
          href={API_REFERENCE_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-foreground underline underline-offset-2"
        >
          <BookOpen className="size-3.5" />
          API reference
        </a>
      </p>

      {!state.instanceEnabled && (
        <p className="rounded-lg border border-border bg-muted px-3 py-2 text-sm">
          The operator has turned the API off for this whole instance. Existing tokens do not work
          until it is turned back on.
        </p>
      )}
      {state.block && <UserApiBlockBanner block={state.block} />}

      {state.canManage && (
        <ManagerSettings
          key={`${state.apiEnabled}:${state.apiScopes.join(',')}`}
          mapId={mapId}
          enabled={state.apiEnabled}
          scopes={state.apiScopes}
          onSaved={load}
        />
      )}
      {state.mapTokens && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Every token on this map</h3>
          <TokenTable tokens={state.mapTokens} showOwner onRevoked={load} />
        </section>
      )}

      <section className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="text-sm font-medium">Your tokens</h3>
        <TokenTable tokens={state.ownTokens} showOwner={false} onRevoked={load} />
        <CreateTokenForm
          mapId={mapId}
          exposed={apiEnabled ? apiScopes : []}
          blocker={mintBlocker}
          onCreated={(token) => {
            setRevealed(token);
            load();
          }}
        />
      </section>

      {reveal}
    </div>
  );
}

function ManagerSettings({
  mapId,
  enabled: savedEnabled,
  scopes: savedScopes,
  onSaved,
}: {
  mapId: string;
  enabled: boolean;
  scopes: ApiScope[];
  onSaved: () => void;
}) {
  const [enabled, setEnabled] = useState(savedEnabled);
  const [scopes, setScopes] = useState<Set<ApiScope>>(() => new Set(savedScopes));
  const [pending, startTransition] = useTransition();

  function toggleScope(scope: ApiScope, on: boolean) {
    setScopes((prev) => {
      const next = new Set(prev);
      if (on) next.add(scope);
      else next.delete(scope);
      return next;
    });
  }

  function onToggleEnabled(on: boolean) {
    setEnabled(on);
    // A save that turns the API off cannot also change its scopes.
    if (!on) setScopes(new Set(savedScopes));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await updateMapApiSettings({ mapId, enabled, scopes: [...scopes] });
      if (result.ok) {
        toast.success('API settings saved.');
        onSaved();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <label className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="font-medium text-foreground">Enable the API on this map</span>
          <span className="text-xs text-muted-foreground">
            Lets anyone who can see this map create tokens for the data you choose below. Turning it
            off stops every token on the map at once.
          </span>
        </div>
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={enabled}
          onChange={(e) => onToggleEnabled(e.target.checked)}
          aria-label="Enable the API on this map"
        />
      </label>

      <fieldset className="flex flex-col gap-1" disabled={!enabled}>
        <legend className="px-2 pb-1 text-xs text-muted-foreground">
          What tokens on this map may read
        </legend>
        {SCOPES.map((s) => (
          <label
            key={s.scope}
            className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
          >
            <div className="flex flex-1 flex-col gap-0.5">
              <span className="font-medium text-foreground">{s.label}</span>
              <span className="text-xs text-muted-foreground">{s.description}</span>
            </div>
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={scopes.has(s.scope)}
              onChange={(e) => toggleScope(s.scope, e.target.checked)}
              aria-label={`Expose ${s.label}`}
            />
          </label>
        ))}
      </fieldset>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          <Save />
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}

function TokenTable({
  tokens,
  showOwner,
  onRevoked,
}: {
  tokens: UserApiTokenListItem[];
  showOwner: boolean;
  onRevoked: () => void;
}) {
  if (tokens.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
        No tokens.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-muted-foreground">
            <th className="px-2 py-1.5 text-left font-medium">Label</th>
            {showOwner && <th className="px-2 py-1.5 text-left font-medium">Owner</th>}
            <th className="px-2 py-1.5 text-left font-medium">Scopes</th>
            {!showOwner && <th className="px-2 py-1.5 text-left font-medium">Expires</th>}
            <th className="px-2 py-1.5 text-left font-medium">Last used</th>
            {showOwner && <th className="px-2 py-1.5 text-left font-medium">Requests</th>}
            <th className="px-2 py-1.5 text-left font-medium">Status</th>
            <th className="px-2 py-1.5" />
          </tr>
        </thead>
        <tbody>
          {tokens.map((token) => (
            <tr key={token.id} className="border-t border-foreground/10">
              <td className="px-2 py-1.5">
                <div className="font-medium">{token.label}</div>
                <div className="font-mono text-xs text-muted-foreground">apu_{token.prefix}…</div>
              </td>
              {showOwner && (
                <td className="px-2 py-1.5 text-muted-foreground">
                  {token.ownerName ?? 'Unknown'}
                </td>
              )}
              <td className="px-2 py-1.5 text-muted-foreground">{describeScopes(token.scopes)}</td>
              {!showOwner && (
                <td className="px-2 py-1.5 text-muted-foreground">
                  {formatUserApiDate(token.expiresAt, 'Never')}
                </td>
              )}
              <td className="px-2 py-1.5 text-muted-foreground">
                {formatUserApiDate(token.lastUsedAt, 'Never')}
              </td>
              {showOwner && (
                <td className="px-2 py-1.5 text-muted-foreground">{token.requestCount}</td>
              )}
              <td className="px-2 py-1.5 text-muted-foreground">
                {describeUserApiTokenStatus(token)}
              </td>
              <td className="px-2 py-1.5">
                <div className="flex justify-end">
                  <UserApiRevokeButton token={token} onRevoked={onRevoked} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CreateTokenForm({
  mapId,
  exposed,
  blocker,
  onCreated,
}: {
  mapId: string;
  exposed: ApiScope[];
  /** Why a token cannot be created right now; null when it can. */
  blocker: string | null;
  onCreated: (token: string) => void;
}) {
  const [label, setLabel] = useState('');
  const [chosen, setChosen] = useState<Set<ApiScope>>(() => new Set());
  const [expiry, setExpiry] = useState('90');
  const [pending, startTransition] = useTransition();
  const offered = SCOPES.filter((s) => exposed.includes(s.scope));
  const disabled = blocker !== null;

  function toggle(scope: ApiScope, on: boolean) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(scope);
      else next.delete(scope);
      return next;
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) {
      toast.error('Give the token a label so you can tell your tokens apart.');
      return;
    }
    const scopes = offered.map((s) => s.scope).filter((s) => chosen.has(s));
    if (scopes.length === 0) {
      toast.error('Choose at least one scope.');
      return;
    }
    startTransition(async () => {
      const result = await createMapApiToken({
        mapId,
        label: label.trim(),
        scopes,
        expiresInDays: EXPIRY_OPTIONS.find((o) => o.value === expiry)?.days ?? null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setLabel('');
      setChosen(new Set());
      onCreated(result.data.token);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 pt-2">
      <div className="text-sm font-medium">New token</div>
      {blocker && <p className="text-sm text-muted-foreground">{blocker}</p>}

      <fieldset className="flex flex-col gap-3" disabled={disabled}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="api-token-label" className="text-sm">
              Label
            </label>
            <Input
              id="api-token-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={60}
              placeholder="e.g. Chain bot"
              disabled={disabled}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="api-token-expiry" className="text-sm">
              Expires
            </label>
            <Select
              value={expiry}
              onValueChange={(v) => setExpiry(v as string)}
              disabled={disabled}
            >
              <SelectTrigger id="api-token-expiry">
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

        {offered.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="px-2 text-xs text-muted-foreground">What the token may read</span>
            {offered.map((s) => (
              <label
                key={s.scope}
                className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
              >
                <div className="flex flex-1 flex-col gap-0.5">
                  <span className="font-medium text-foreground">{s.label}</span>
                  <span className="text-xs text-muted-foreground">{s.description}</span>
                </div>
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={chosen.has(s.scope)}
                  onChange={(e) => toggle(s.scope, e.target.checked)}
                  aria-label={`Token reads ${s.label}`}
                />
              </label>
            ))}
          </div>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={disabled || pending}>
            <KeyRound />
            {pending ? 'Creating…' : 'Create token'}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

function RevealDialog({ token, onClose }: { token: string | null; onClose: () => void }) {
  async function onCopy() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      toast.success('Token copied.');
    } catch {
      toast.error('Could not copy. Select the token and copy it manually.');
    }
  }

  return (
    <Dialog open={token !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Your new API token</DialogTitle>
          <DialogDescription>
            Copy it now. It will not be shown again: Aperture keeps only a fingerprint of it, so a
            lost token cannot be recovered, only revoked and replaced.
          </DialogDescription>
        </DialogHeader>
        <Input
          readOnly
          value={token ?? ''}
          aria-label="New API token"
          className="font-mono text-xs"
          onFocus={(e) => e.currentTarget.select()}
        />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => void onCopy()}>
            <Copy />
            Copy
          </Button>
          <DialogClose render={<Button type="button" />}>Done</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
