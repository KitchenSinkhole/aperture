/**
 * Browser-side fire-and-forget reporter for the Phase 7 client error capture.
 * Shared by `ClientErrorBoundary` (React render crashes) and
 * `ClientErrorReporter` (`window.onerror` / `unhandledrejection`).
 *
 * Deliberately NOT built on `requestJson`: that helper pops a `toast.error` on
 * failure, which is wrong for silent background reporting and risks a
 * report→error→report loop. This swallows every failure and never toasts.
 * `keepalive` lets a report survive an in-flight unload/navigation.
 */

export interface ClientErrorReport {
  message: string;
  stack?: string;
  componentStack?: string;
  route?: string;
}

export function reportClientError(report: ClientErrorReport): void {
  try {
    void fetch('/api/client-errors', {
      method: 'POST',
      keepalive: true,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    }).catch(() => {
      // swallow — error reporting must never surface its own failure
    });
  } catch {
    // swallow (e.g. JSON.stringify on a pathological payload)
  }
}
