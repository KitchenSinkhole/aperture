import Link from 'next/link';
import { apertureConfig } from '../../../aperture.config';

// The one piece of the page that is about Aperture rather than the chain. Slim,
// persistent, and quiet: the map is the argument, this is just the signature.

export function PromoBar({ mapName, shareLabel }: { mapName: string; shareLabel: string }) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-spec-line px-5 py-3">
      <span className="flex items-center gap-2">
        <span
          className="animate-spec-pulse size-2 rounded-full bg-spec-live"
          aria-hidden
        />
        <span className="font-spec-mono text-[13px] font-bold uppercase tracking-[0.22em] text-spec-text">
          Aperture
        </span>
      </span>

      <span className="min-w-0 flex items-baseline gap-2">
        <h1 className="truncate font-spec-mono text-[22px] font-semibold tracking-tight text-spec-text">
          {mapName}
        </h1>
        <span className="truncate font-spec-mono text-xs text-spec-dim">{shareLabel}</span>
      </span>

      <nav className="ml-auto flex items-center gap-4 font-spec-mono text-xs">
        <Link
          href="/"
          className="text-spec-dim underline-offset-4 transition-colors hover:text-spec-text hover:underline"
        >
          Open Aperture
        </Link>
        <a
          href={apertureConfig.PUBLIC_LINKS.repo}
          target="_blank"
          rel="noreferrer noopener"
          className="text-spec-dim underline-offset-4 transition-colors hover:text-spec-text hover:underline"
        >
          Source
        </a>
      </nav>
    </header>
  );
}
