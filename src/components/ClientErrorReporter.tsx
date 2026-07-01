'use client';

import { useEffect } from 'react';
import { reportClientError } from '@/lib/log/reportClientError';

/**
 * Effect-only, render-nothing component (mirrors `LowContrastController`) that
 * captures errors the React error boundary can't see: uncaught `window.onerror`
 * exceptions and unhandled promise rejections. Both are reported (scrubbed
 * server-side) to `/api/client-errors`.
 *
 * Mounted just inside `RealtimeProvider`, OUTSIDE `ClientErrorBoundary`, so it
 * keeps reporting even when the page subtree has crashed.
 */
export function ClientErrorReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent): void => {
      // Cross-origin script errors are opaque ("Script error.", no stack) — no
      // useful payload, so skip them rather than logging noise.
      if (!event.error && event.message === 'Script error.') return;
      reportClientError({
        message: event.error?.message ?? event.message,
        stack: event.error?.stack,
        route: location.pathname,
      });
    };

    const onRejection = (event: PromiseRejectionEvent): void => {
      const reason = event.reason;
      reportClientError({
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
        route: location.pathname,
      });
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
