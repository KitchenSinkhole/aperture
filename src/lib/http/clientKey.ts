/**
 * Best-effort caller IP for rate-limiting anonymous requests: first entry of
 * `X-Forwarded-For`, else `X-Real-IP`, else `'unknown'`. Shared so the public
 * snapshot route (fetch API headers) and the public WS upgrade handler (raw
 * Node headers) key their limiters off the same precedence — each caller
 * extracts the raw header value with whatever API its request object exposes.
 */
export function clientKeyFromForwardedFor(
  forwardedFor: string | undefined | null,
  realIp: string | undefined | null,
): string {
  if (forwardedFor) return forwardedFor.split(',')[0]!.trim();
  return realIp ?? 'unknown';
}
