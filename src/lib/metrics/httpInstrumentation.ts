import type { NextRequest } from 'next/server';
import { recordHttpRequest } from './registry';

/**
 * Per-route HTTP golden-signals wrapper for App-Router handlers. Each `route.ts`
 * opts in by exporting `export const POST = withApiMetrics('/api/.../:id', handler)`
 * — the `template` is passed explicitly and bounded (dynamic segments written as
 * `:mapId` / `:systemId` / …) so the metric labels never carry a raw path.
 *
 * No `server-only` import: route modules are bundled by Next, but keeping this
 * leaf import-stable matches the rest of `src/lib/metrics/*`.
 */

type ApiHandler<Ctx> = (request: NextRequest, ctx: Ctx) => Promise<Response>;

/**
 * Wrap a Next App-Router handler so each call emits `http_requests_total`
 * `{route, method, status}` and observes `http_request_duration_ms{route}`. A
 * thrown error is recorded as `status='500'` and re-thrown (Next renders the
 * 500), so the latency histogram covers failures too.
 *
 * Generic over the handler's context so the returned function keeps the exact
 * `{ params: Promise<...> }` shape Next infers per route (no-param routes infer
 * `unknown`, which Next still calls with its context object).
 */
export function withApiMetrics<Ctx>(
  template: string,
  handler: ApiHandler<Ctx>,
): ApiHandler<Ctx> {
  return async (request, ctx) => {
    const startedAt = performance.now();
    try {
      const response = await handler(request, ctx);
      recordHttpRequest(
        template,
        request.method,
        String(response.status),
        performance.now() - startedAt,
      );
      return response;
    } catch (err) {
      recordHttpRequest(template, request.method, '500', performance.now() - startedAt);
      throw err;
    }
  };
}
