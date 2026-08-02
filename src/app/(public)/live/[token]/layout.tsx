import type { ReactNode } from 'react';

/**
 * Full-bleed shell for the spectator view. The `(public)` group carries no
 * layout of its own, so this sits directly inside the root layout and gives
 * the map the whole viewport with no app header, footer or sidebar.
 */
export default function PublicMapLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      {children}
    </div>
  );
}
