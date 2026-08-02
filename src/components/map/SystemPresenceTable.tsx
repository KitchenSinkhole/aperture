import { useMemo } from 'react';
import { ShipClassIcon } from '@/components/icons/ShipClassIcon';
import { customShipName } from '@/lib/map/shipName';
import type { ShipClass } from '@/types';

/**
 * The fields this table reads, rather than a whole `MapPresenceEntry`, so the
 * public share's narrower `PublicPresencePilot` satisfies it too.
 */
export type PresenceTableRow = {
  characterId: number;
  characterName: string;
  shipClass: ShipClass | null;
  shipTypeName: string | null;
  shipName: string | null;
};

/**
 * Dense, self-contained pilot table for the `SystemNode` presence-badge popup.
 * Header-less Pilot / Type / Ship list for a single system — sorted by name,
 * no location, grouping, or viewing-status affordances (the popover already
 * scopes everything to one system). Deliberately separate from
 * `PilotRosterTable`, whose needs have diverged.
 */
export function SystemPresenceTable({ presence }: { presence: readonly PresenceTableRow[] }) {
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
            <td className="!p-0 w-4">
              <ShipClassIcon shipClass={p.shipClass} />
            </td>
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
