import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Geist } from 'next/font/google';

import { cn } from '@/lib/utils';
import { env } from '@/lib/env';
import { experimentalUiHtmlAttributes } from '@/lib/experimentalUi';
import { getExperimentalUiFromCookies } from '@/lib/experimentalUi.server';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'Aperture',
  description: 'Collaborative wormhole mapping for EVE Online',
  // Resolves the relative OG image URLs a share link's unfurl card points at.
  // Absent when the deployment hasn't declared its own origin.
  metadataBase: env.AUTH_URL ? new URL(env.AUTH_URL) : undefined,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const experimentalUi = await getExperimentalUiFromCookies();
  const uiAttrs = experimentalUiHtmlAttributes(experimentalUi);

  return (
    <html lang="en" className={cn('dark font-sans', geist.variable)} {...uiAttrs}>
      <body>{children}</body>
    </html>
  );
}
