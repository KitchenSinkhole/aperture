import type { IncomingMessage } from 'node:http';
import { env } from '@/lib/env';

/**
 * Caller-address resolution for the in-process rate limiters (user API,
 * public snapshot, public WebSocket). No address is ever persisted.
 *
 * `server.ts` resolves the address once per HTTP request and writes it to
 * `CLIENT_IP_HEADER`, overwriting any value the client sent, so route handlers
 * read a value no client can choose. The WebSocket upgrade handler resolves its
 * own requests the same way.
 */

/** Request header carrying the resolved caller address to route handlers. */
export const CLIENT_IP_HEADER = 'x-aperture-client-ip';

/**
 * The caller's address, given that the last `trustedHops` hops before this
 * process are reverse proxies the operator controls. Each trusted proxy
 * appends the address it received the request from to `X-Forwarded-For`, so
 * the caller is the entry `trustedHops` places from the right; anything left of
 * it was written by the client. Zero hops is the socket's own peer.
 *
 * A request carrying fewer entries than `trustedHops` did not pass through
 * every proxy (or a proxy sets only `X-Real-IP`): it falls back to
 * `X-Real-IP`, then the left-most entry, then the socket peer.
 */
export function resolveClientIp(
  parts: {
    forwardedFor: string | undefined | null;
    realIp: string | undefined | null;
    socketAddress: string | undefined | null;
  },
  trustedHops: number,
): string {
  const socket = parts.socketAddress || 'unknown';
  if (trustedHops === 0) return socket;
  const forwarded = (parts.forwardedFor ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  if (forwarded.length >= trustedHops) return forwarded[forwarded.length - trustedHops]!;
  return parts.realIp?.trim() || forwarded[0] || socket;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(', ') : value;
}

/** `resolveClientIp` over a raw Node request, with `TRUSTED_PROXY_HOPS` from the environment. */
export function clientIpOfNodeRequest(
  req: IncomingMessage,
  trustedHops: number = env.TRUSTED_PROXY_HOPS,
): string {
  return resolveClientIp(
    {
      forwardedFor: headerValue(req.headers['x-forwarded-for']),
      realIp: headerValue(req.headers['x-real-ip']),
      socketAddress: req.socket.remoteAddress,
    },
    trustedHops,
  );
}

/**
 * The resolved caller address of a route-handler request, or `'unknown'` when
 * the request did not come through `server.ts` (tests calling a handler
 * directly).
 */
export function clientIpOfRequest(headers: Headers): string {
  return headers.get(CLIENT_IP_HEADER) || 'unknown';
}
