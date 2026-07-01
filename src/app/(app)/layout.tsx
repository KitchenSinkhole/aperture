import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { Toaster } from 'sonner';
import {
  getAccountCharacters,
  getActiveCharacter,
  getConnectionTravelAnimation,
  getMainCharacterId,
  getSignatureIndicatorAccountSettings,
  requireSession,
} from '@/lib/session';
import { AppHeader } from '@/components/chrome/AppHeader';
import { AppFooter } from '@/components/chrome/AppFooter';
import { RealtimeProvider } from '@/lib/realtime/useRealtime';
import { RealtimeStatusBanner } from '@/components/RealtimeStatusBanner';
import { LowContrastController } from '@/components/LowContrastController';
import { ClientErrorReporter } from '@/components/ClientErrorReporter';
import { ClientErrorBoundary } from '@/components/ClientErrorBoundary';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const active = await getActiveCharacter();
  if (!active) redirect('/');
  const characters = await getAccountCharacters(session.userId);
  const mainCharacterId = await getMainCharacterId(session.userId);
  const travelAnimation = await getConnectionTravelAnimation(session.userId);
  const signatureIndicators = await getSignatureIndicatorAccountSettings(session.userId);

  return (
    <RealtimeProvider>
      <LowContrastController />
      <ClientErrorReporter />
      <div className="flex min-h-screen flex-col">
        <RealtimeStatusBanner />
        <AppHeader
          active={{ id: active.id.toString(), name: active.name }}
          characters={characters}
          mainCharacterId={mainCharacterId}
          travelAnimation={travelAnimation}
          signatureIndicators={signatureIndicators}
        />
        <main className="w-full flex-1 px-4 py-3">
          <ClientErrorBoundary>{children}</ClientErrorBoundary>
        </main>
        <AppFooter />
        <Toaster />
      </div>
    </RealtimeProvider>
  );
}
