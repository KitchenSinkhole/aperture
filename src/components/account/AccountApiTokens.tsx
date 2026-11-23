'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { getAccountApiTokens } from '@/app/(app)/actions/mapApi';
import {
  UserApiBlockBanner,
  UserApiRevokeButton,
  describeUserApiTokenStatus,
  formatUserApiDate,
} from '@/components/userApi/UserApiTokenParts';
import type { AccountApiState } from '@/types';

/**
 * Account Settings' "API tokens" section: every token the account owns, on
 * any map, with its status and a revoke button, plus the account's block. The
 * one place a token on a map the account can no longer open stays reachable.
 */
export function AccountApiTokens() {
  const [state, setState] = useState<AccountApiState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const load = useCallback(() => {
    startTransition(async () => {
      const result = await getAccountApiTokens();
      if (result.ok) {
        setState(result.data);
        setError(null);
      } else {
        setError(result.error);
      }
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5 px-1">
        <span className="text-sm font-medium text-foreground">API tokens</span>
        <span className="text-xs text-muted-foreground">
          Every token your account holds, on any map. Create tokens from a map&apos;s Settings, API
          tab.
        </span>
      </div>

      {error ? (
        <p className="px-1 text-sm text-destructive">{error}</p>
      ) : !state ? (
        <p className="px-1 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          {!state.instanceEnabled && (
            <p className="rounded-lg border border-border bg-muted px-3 py-2 text-sm">
              The operator has turned the API off for this whole instance. Your tokens do not work
              until it is turned back on.
            </p>
          )}
          {state.block && <UserApiBlockBanner block={state.block} />}
          {state.tokens.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
              No tokens.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {state.tokens.map((token) => (
                <li
                  key={token.id}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-medium text-foreground">
                      {token.label}{' '}
                      <span className="font-mono text-xs font-normal text-muted-foreground">
                        apu_{token.prefix}…
                      </span>
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{token.mapName}</span>
                    <span className="text-xs text-muted-foreground">
                      {describeUserApiTokenStatus(token)} · Last used{' '}
                      {formatUserApiDate(token.lastUsedAt, 'never')}
                    </span>
                  </div>
                  <UserApiRevokeButton token={token} onRevoked={load} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
