'use client';

import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { effectiveBookmarkScheme } from '@/lib/bookmarking/scheme';
import type { BookmarkTransit } from '@/components/map/BookmarkTransitBridge';
import type { BookmarkInput, MapSignature } from '@/types';

type BookmarkModuleProps = {
  transit: BookmarkTransit | null;
  signatures: MapSignature[];
};

async function copyBookmarkName(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success('Bookmark name copied.');
  } catch {
    toast.error('Could not copy — select the text and copy it manually.');
  }
}

/** One row: a system-labelled bookmark name, clipped for display with the full string in the title and copied verbatim. */
function BookmarkRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-medium uppercase text-muted-foreground">{label}</div>
        <div className="truncate font-mono text-xs" title={value}>
          {value}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6 shrink-0"
        aria-label={`Copy bookmark for ${label}`}
        onClick={() => void copyBookmarkName(value)}
      >
        <Copy className="size-3.5" />
      </Button>
    </div>
  );
}

/**
 * Sidebar panel showing the two bookmark names for the wormhole a viewer's
 * own pilot has just transited, one per endpoint system, each with a copy
 * button. Pure display: the transit it renders is resolved and frozen by
 * `useBookmarkTransit` in the always-mounted owner above it.
 */
export function BookmarkModule({ transit, signatures }: BookmarkModuleProps) {
  // Recomputed from the frozen transit on every render; unaffected by any
  // graph change except a signature bound to this hole's connection, since
  // `signatures` is the only live input and everything else in `transit`
  // stays fixed to the moment it was captured.
  const boundSignatures = transit
    ? signatures.filter((s) => s.mapConnectionId === transit.connection.id)
    : [];
  const names = transit
    ? effectiveBookmarkScheme.names({
        here: transit.here,
        cameFrom: transit.cameFrom,
        connection: transit.connection,
        connections: transit.connections,
        signatures: boundSignatures,
        hopsFromHome: transit.hopsFromHome,
        homeMapSystemId: transit.homeMapSystemId,
      } satisfies BookmarkInput)
    : null;

  const missingSig =
    transit !== null &&
    (!boundSignatures.some((s) => s.mapSystemId === transit.here.id) ||
      !boundSignatures.some((s) => s.mapSystemId === transit.cameFrom.id));

  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-2">
        {!transit ? (
          <p className="text-xs text-muted-foreground">
            Jump through a wormhole to generate bookmark names.
          </p>
        ) : names === null ? (
          <p className="text-xs text-muted-foreground">
            The active naming scheme has no name for this wormhole.
          </p>
        ) : (
          <>
            <BookmarkRow label={transit.here.alias ?? transit.here.name} value={names.here} />
            <BookmarkRow
              label={transit.cameFrom.alias ?? transit.cameFrom.name}
              value={names.cameFrom}
            />
            {missingSig && (
              <p className="text-xs text-destructive/70">
                A signature on this hole hasn&apos;t been entered yet — scan it in Aperture for a
                complete name.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
