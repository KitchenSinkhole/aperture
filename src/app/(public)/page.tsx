import Image from 'next/image';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { LoginButton } from '@/components/chrome/LoginButton';

export default async function LandingPage() {
  const session = await getSession();
  if (session?.characterId) redirect('/maps');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-4 text-center">
      <div className="flex flex-col items-center gap-3">
        <Image src="/aperture logo.png" alt="Aperture" width={120} height={120} priority />
        <h1 className="font-heading text-4xl font-semibold tracking-tight">Aperture</h1>
        <p className="max-w-md text-muted-foreground">
          Collaborative wormhole mapping for EVE Online. Sign in with your EVE character to
          map chains with your corp in real time.
        </p>
      </div>
      <LoginButton />
    </main>
  );
}
