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
import { CurrentMapScopeProvider } from '@/components/chrome/CurrentMapScopeContext';
import { RealtimeStatusBanner } from '@/components/RealtimeStatusBanner';
import { SdeStatusBanner } from '@/components/SdeStatusBanner';
import { AppUpdateBanner } from '@/components/AppUpdateBanner';
import { LowContrastController } from '@/components/LowContrastController';
import { ClientErrorReporter } from '@/components/ClientErrorReporter';
import { ClientErrorBoundary } from '@/components/ClientErrorBoundary';
import { getSdeStatus } from '@/lib/sde/status';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const active = await getActiveCharacter();
  if (!active) redirect('/');
  const characters = await getAccountCharacters(session.userId);
  const mainCharacterId = await getMainCharacterId(session.userId);
  const travelAnimation = await getConnectionTravelAnimation(session.userId);
  const signatureIndicators = await getSignatureIndicatorAccountSettings(session.userId);
  const sdeStatus = await getSdeStatus();

  return (
    <RealtimeProvider>
      <CurrentMapScopeProvider>
        <LowContrastController />
        <ClientErrorReporter />
        <div className="flex min-h-screen flex-col">
          <RealtimeStatusBanner />
          <SdeStatusBanner initial={sdeStatus} />
          <AppUpdateBanner />
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
      </CurrentMapScopeProvider>
    </RealtimeProvider>
  );
}
