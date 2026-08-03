import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SpectatorView } from '@/components/public/SpectatorView';
import { getPublicSnapshot } from '@/lib/map/publicSnapshot';

/**
 * The spectator view: a read-only render of a shared map for a viewer with no
 * session. Everything on the page comes from `getPublicSnapshot`, the single
 * code path that emits public map data.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const data = await getPublicSnapshot(token);
  if (!data) {
    return { title: 'Aperture', robots: { index: false, follow: false } };
  }

  const title = `${data.map.name} | Aperture`;
  const description = `A live wormhole chain shared from Aperture. ${data.systems.length} ${
    data.systems.length === 1 ? 'system' : 'systems'
  } mapped, with the k-space entrances and the signatures to scan.`;

  return {
    title,
    description,
    // A share link is unguessable and revocable; indexing it would outlive both.
    // Chat and forum unfurlers ignore robots, so the card still renders.
    robots: { index: false, follow: false },
    openGraph: { title, description, type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function PublicMapPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await getPublicSnapshot(token);
  if (!data) notFound();

  return <SpectatorView token={token} initialData={data} />;
}
