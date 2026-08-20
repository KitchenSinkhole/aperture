'use client';

import { useCallback, useEffect, useState } from 'react';
import { WebhookForm } from './WebhookForm';
import { WebhookHealthBadge } from './WebhookHealthBadge';
import { WebhookRowActions } from './WebhookRowActions';

type WebhookChannel = 'discord';
type WebhookEvent = 'history' | 'rally';

type WebhookRow = {
  id: string;
  channel: WebhookChannel;
  event: WebhookEvent;
  url: string;
  username: string | null;
  lastStatus: number | null;
  lastError: string | null;
  lastAttemptedAt: string | null;
  consecutiveFailures: number;
};

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** Mask a webhook URL down to host + last 4 path chars (shoulder-surfing defense). */
function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() ?? '';
    const tail = last.length > 6 ? `…${last.slice(-4)}` : last;
    return `${u.host}/…/${tail}`;
  } catch {
    return url.length > 40 ? `${url.slice(0, 37)}…` : url;
  }
}

/**
 * Webhooks editor for the in-map Settings → Webhooks tab. Fetches the list from
 * `/api/map/[mapId]/webhooks` (gated by `webhooks_manage`) and refetches after
 * every create / edit / delete / test / reset.
 */
export function MapWebhooksPanel({ mapId }: { mapId: string }) {
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Bumping the nonce re-runs the load effect — the mutation callbacks call
  // `refetch` to reload after create / edit / delete / test / reset.
  const [reloadNonce, setReloadNonce] = useState(0);
  const refetch = useCallback(() => setReloadNonce((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/map/${mapId}/webhooks`, { signal: controller.signal });
        const json: { ok: boolean; data?: { webhooks: WebhookRow[] }; error?: string } =
          await res.json();
        if (!active) return;
        if (!json.ok || !json.data) {
          setError(json.error ?? 'Failed to load webhooks.');
          return;
        }
        setWebhooks(json.data.webhooks);
      } catch (err) {
        if (active && !(err instanceof DOMException && err.name === 'AbortError')) {
          setError('Failed to load webhooks.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [mapId, reloadNonce]);

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {webhooks.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          {loading ? 'Loading…' : 'No webhooks configured for this map yet.'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Event</th>
                <th className="px-3 py-2 font-medium">URL</th>
                <th className="px-3 py-2 font-medium">Health</th>
                <th className="px-3 py-2 font-medium">Last attempt</th>
                <th className="w-px px-3 py-2 font-medium" aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {webhooks.map((w) => (
                <tr key={w.id} className="border-t border-border">
                  <td className="px-3 py-2 align-middle capitalize">{w.event}</td>
                  <td className="px-3 py-2 align-middle">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs" title={w.url}>
                      {maskUrl(w.url)}
                    </code>
                    {w.username && (
                      <span className="ml-2 text-xs text-muted-foreground">as “{w.username}”</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <WebhookHealthBadge
                      lastStatus={w.lastStatus}
                      consecutiveFailures={w.consecutiveFailures}
                      lastError={w.lastError}
                    />
                  </td>
                  <td className="px-3 py-2 align-middle text-xs text-muted-foreground">
                    {w.lastAttemptedAt ? DATE_FORMAT.format(new Date(w.lastAttemptedAt)) : '—'}
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <WebhookRowActions
                      webhook={{
                        id: w.id,
                        channel: w.channel,
                        event: w.event,
                        url: w.url,
                        username: w.username,
                        consecutiveFailures: w.consecutiveFailures,
                      }}
                      onChanged={() => void refetch()}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <WebhookForm mode="create" mapId={mapId} onCreated={() => void refetch()} />
    </div>
  );
}
