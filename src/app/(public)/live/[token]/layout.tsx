import type { ReactNode } from 'react';
import { Geist_Mono } from 'next/font/google';
import { cn } from '@/lib/utils';

const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-spec-mono' });

/**
 * Full-bleed shell for the spectator view. The `(public)` group carries no
 * layout of its own, so this sits directly inside the root layout and gives the
 * map the whole viewport with no app header, footer or sidebar.
 *
 * The `spectator` class scopes the view's own palette (see `globals.css`); its
 * tokens resolve nowhere else in the app. Mono is loaded here rather than at the
 * root because it is this page's dominant voice and no other route uses it.
 */
export default function PublicMapLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        'spectator flex h-screen w-screen flex-col overflow-hidden bg-spec-field text-spec-text',
        geistMono.variable,
      )}
    >
      {children}
    </div>
  );
}
