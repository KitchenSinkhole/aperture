'use client';

import { Flag, Lock, Users } from 'lucide-react';
import type { IntelScope } from '@/types';

/**
 * The audience each scope names, phrased without reference to the viewer: an
 * admin reads rows belonging to organisations they are not in, so "your corp"
 * would be a lie on exactly the surface that most needs to be exact.
 */
const SCOPE_COPY: Record<IntelScope, { label: string; audience: string }> = {
  private: { label: 'Private', audience: 'Visible only to the character it belongs to.' },
  corp: { label: 'Corp', audience: 'Visible to every member of the corporation it belongs to.' },
  alliance: { label: 'Alliance', audience: 'Visible to every member of the alliance it belongs to.' },
};

const SCOPE_STYLE: Record<IntelScope, string> = {
  private: 'border-border bg-muted text-muted-foreground',
  corp: 'border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400',
  alliance: 'border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400',
};

function ScopeIcon({ scope, className }: { scope: IntelScope; className: string }) {
  if (scope === 'private') return <Lock className={className} />;
  if (scope === 'corp') return <Users className={className} />;
  return <Flag className={className} />;
}

/** The sentence describing who an intel row at this scope reaches. */
export function intelScopeAudience(scope: IntelScope): string {
  return SCOPE_COPY[scope].audience;
}

/**
 * Who may see one row of intel. Deliberately a bordered word-and-icon pill
 * rather than an entity logo: structure rows also carry the citadel's in-game
 * owner corp with its CCP logo, and two corp facts in the same visual language
 * on one row read as one fact.
 *
 * The chip names the tier and not the entity. For every non-admin the scope
 * entity is necessarily their own character, corp or alliance — the read filter
 * admits no other — so a name would repeat what the tier already says while
 * competing with the owner corp beside it.
 */
export function IntelScopeChip({ scope, className }: { scope: IntelScope; className?: string }) {
  const { label, audience } = SCOPE_COPY[scope];
  return (
    <span
      title={audience}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide ${SCOPE_STYLE[scope]} ${className ?? ''}`}
    >
      <ScopeIcon scope={scope} className="size-2.5" />
      {label}
    </span>
  );
}
