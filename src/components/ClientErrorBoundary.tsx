'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { reportClientError } from '@/lib/log/reportClientError';

/**
 * The codebase's first React error boundary. Wraps the `(app)` `<main>` so a
 * render crash in the page subtree shows a recoverable fallback instead of a
 * blank screen — the chrome (header/footer/banner) lives outside the boundary
 * and stays usable, so the user can navigate away.
 *
 * On catch it reports the error (scrubbed server-side) to `/api/client-errors`
 * via `reportClientError`. Must be a class component — `getDerivedStateFromError`
 * / `componentDidCatch` have no hook equivalent.
 */

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ClientErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportClientError({
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
      route: typeof location !== 'undefined' ? location.pathname : undefined,
    });
  }

  private reset = (): void => {
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
        <div className="space-y-1">
          <h2 className="text-lg font-medium">Something went wrong</h2>
          <p className="text-sm text-muted-foreground">
            This part of the page hit an error. You can try again or reload — the rest of the app is
            still available.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="default" onClick={this.reset}>
            Try again
          </Button>
          <Button variant="outline" onClick={() => location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    );
  }
}
