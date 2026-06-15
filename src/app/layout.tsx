import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Geist } from 'next/font/google';

import { env } from '@/lib/env';
import { cn } from '@/lib/utils';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'Aperture',
  description: 'Collaborative wormhole mapping for EVE Online',
  icons: { icon: env.FAVICON_URL },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={cn('dark font-sans', geist.variable)}>
      <body>{children}</body>
    </html>
  );
}
