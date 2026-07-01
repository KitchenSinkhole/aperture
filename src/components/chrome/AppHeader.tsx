import Image from 'next/image';
import Link from 'next/link';
import type { SignatureIndicatorAccountSettings } from '@/types';
import pkg from '../../../package.json';
import { fetchChangelogReleases, type ChangelogRelease } from '@/lib/integrations/github';
import { CharacterPanel, type PanelCharacter } from './CharacterPanel';
import { EveTimeClock } from './EveTimeClock';
import { ReferenceMenu } from './ReferenceMenu';
import { StatisticsButton } from './StatisticsButton';
import { VersionChip } from './VersionChip';

export async function AppHeader({
  active,
  characters,
  mainCharacterId,
  travelAnimation,
  signatureIndicators,
}: {
  active: { id: string; name: string };
  characters: PanelCharacter[];
  mainCharacterId: string | null;
  travelAnimation: boolean;
  signatureIndicators: SignatureIndicatorAccountSettings;
}) {
  // A changelog fetch failure (GitHub down, rate limit) must never break the
  // header — the chip just renders without release notes.
  let releases: ChangelogRelease[] = [];
  try {
    releases = await fetchChangelogReleases();
  } catch {
    releases = [];
  }

  return (
    <header className="border-b border-border">
      <div className="flex h-9 items-center justify-between px-4">
        <div className="flex items-center gap-1.5">
          <Link href="/maps" className="flex items-center gap-2 font-heading text-lg font-semibold tracking-tight">
            <Image src="/aperture logo.png" alt="Aperture" width={20} height={20} className="h-5 w-5" />
            Aperture
          </Link>
          <VersionChip version={pkg.version} releases={releases} />
        </div>
        <div className="flex items-center gap-1">
          <StatisticsButton />
          <ReferenceMenu />
          <EveTimeClock />
          <CharacterPanel
            active={active}
            characters={characters}
            mainCharacterId={mainCharacterId}
            travelAnimation={travelAnimation}
            signatureIndicators={signatureIndicators}
          />
        </div>
      </div>
    </header>
  );
}
