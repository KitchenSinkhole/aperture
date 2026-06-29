import { useMemo } from 'react';
import { customShipName } from '@/components/map/PilotRosterTable';
import type { MapPresenceEntry } from '@/types';

/**
 * Dense, self-contained pilot table for the `SystemNode` presence-badge popup.
 * Header-less Pilot / Type / Ship list for a single system — sorted by name,
 * no location, grouping, or viewing-status affordances (the popover already
 * scopes everything to one system). Deliberately separate from
 * `PilotRosterTable`, whose needs have diverged.
 */
export function SystemPresenceTable({ presence }: { presence: readonly MapPresenceEntry[] }) {
  const sorted = useMemo(
    () => [...presence].sort((a, b) => a.characterName.localeCompare(b.characterName)),
    [presence],
  );

  return (
    <table className="w-full text-xs [&_td]:px-2 [&_td]:py-0.5">
      <tbody>
        {sorted.map((p) => (
          <tr key={p.characterId}>
            <td>{p.characterName}</td>
            <ClippedCell className="text-muted-foreground">{p.shipTypeName ?? '—'}</ClippedCell>
            <ClippedCell className="text-muted-foreground">{customShipName(p) || '—'}</ClippedCell>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Clips long ship names to a responsive max width with an ellipsis and exposes
 * the full value via a native tooltip. The inner `block` span is required
 * because `truncate` does not clip reliably on a bare `<td>`.
 */
function ClippedCell({ className, children }: { className?: string; children: string }) {
  return (
    <td className={className}>
      <span className="block max-w-[100px] truncate lg:max-w-[180px]" title={children}>
        {children}
      </span>
    </td>
  );
}
