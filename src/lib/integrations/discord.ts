import { apertureConfig } from '../../../aperture.config';

/**
 * Discord webhook client. Thin POST wrapper around `fetch` —
 * Discord webhooks return 204 No Content on success and a small JSON error
 * body otherwise, so there is no response schema to decode and no circuit
 * breaker (one webhook URL is one channel; per-URL `consecutive_failures` on
 * `ap_map_webhook` is the equivalent gating signal, owned by the dispatcher).
 *
 * Spec: https://discord.com/developers/docs/resources/webhook#execute-webhook
 */

/** Minimal subset of the Discord webhook payload the dispatcher uses. */
export interface DiscordWebhookEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordWebhookEmbed {
  title?: string;
  description?: string;
  /** 24-bit RGB integer (e.g. `0xE74C3C` for red). */
  color?: number;
  timestamp?: string;
  fields?: DiscordWebhookEmbedField[];
  footer?: { text: string };
}

export interface DiscordWebhookPayload {
  /** Plain message text (≤2000 chars). At least one of `content`/`embeds` is required. */
  content?: string;
  /** Optional per-message username override; falls back to the webhook's default. */
  username?: string;
  /** Up to 10 embeds per message. */
  embeds?: DiscordWebhookEmbed[];
}

export type DiscordDispatchResult =
  | { ok: true; status: number }
  | {
      ok: false;
      status?: number;
      error: string;
      /**
       * `true` for 5xx, network errors, and 429 (rate-limit) — the dispatcher
       * re-throws on retriable failures so graphile-worker re-schedules per its
       * default backoff. `false` for terminal 4xx (404 deleted webhook, 401
       * bad token, …) — recorded on the `ap_map_webhook` row, no retry.
       */
      retriable: boolean;
      /** Seconds the caller should wait before retrying, when Discord supplies one. */
      retryAfterSeconds?: number;
    };

/**
 * POST a payload to a Discord webhook URL. Never throws — every transport
 * failure is mapped to a `{ ok: false }` result with a `retriable` flag.
 *
 * Mentions are never parsed: message text carries user-supplied labels and
 * names, so an `@everyone` or a role mention in one must not ping anyone.
 */
export async function postDiscordWebhook(
  url: string,
  payload: DiscordWebhookPayload,
): Promise<DiscordDispatchResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Aperture/0.0.0',
      },
      body: JSON.stringify({ ...payload, allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(apertureConfig.INTEGRATION_REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      retriable: true,
    };
  }

  if (res.status >= 200 && res.status < 300) {
    return { ok: true, status: res.status };
  }

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after'));
    return {
      ok: false,
      status: 429,
      error: 'rate limited',
      retriable: true,
      ...(Number.isFinite(retryAfter) ? { retryAfterSeconds: retryAfter } : {}),
    };
  }

  const body = await res.text().catch(() => '');
  return {
    ok: false,
    status: res.status,
    error: body.slice(0, 500) || `HTTP ${res.status}`,
    retriable: res.status >= 500,
  };
}
