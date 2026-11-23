import type { SignatureCleanupPanelSettings } from '@/components/dialogs/SignatureCleanupDialog';
import {
  filterSignaturesForCleanup,
  type SignatureCleanupOptions,
} from '@/lib/map/signatureCleanupFilters';
import { staleSignatureMapSystemIds } from '@/lib/map/signatureCleanupStaleness';
import type {
  MapConnectionEdge,
  MapSignature,
  MapSystemNode,
  SignatureIndicatorPrefs,
} from '@/types';

export function buildSignatureCleanupOptions(
  settings: SignatureCleanupPanelSettings,
  connections: MapConnectionEdge[],
): SignatureCleanupOptions {
  const whExpired = settings.whLinkExpired
    ? new Set(connections.filter((c) => c.eolStage === 'expired').map((c) => c.id))
    : undefined;
  return {
    olderThanHours: settings.olderThanHours ?? undefined,
    unscannedOnly: settings.unscannedOnly || undefined,
    groups: settings.groups.length ? settings.groups : undefined,
    whLinkExpiredConnectionIds: whExpired,
  };
}

/** Signatures matched by the experimental Clean up dialog filters (same rules as preview). */
export function matchSignaturesForExperimentalCleanup(input: {
  settings: SignatureCleanupPanelSettings;
  selectedSystem: MapSystemNode | null;
  systems: MapSystemNode[];
  signatures: MapSignature[];
  connections: MapConnectionEdge[];
  indicatorPrefs: SignatureIndicatorPrefs;
  isWormholeSystem: (mapSystemId: string) => boolean;
  nowMs?: number;
}): MapSignature[] {
  const pool =
    input.settings.scope === 'system' && input.selectedSystem
      ? input.signatures.filter((s) => s.mapSystemId === input.selectedSystem!.id)
      : input.signatures;
  if (input.settings.scope === 'system' && !input.selectedSystem) return [];

  const opts = buildSignatureCleanupOptions(input.settings, input.connections);
  let rows = filterSignaturesForCleanup(pool, input.connections, opts);
  if (input.settings.staleByIndicator) {
    const staleIds = staleSignatureMapSystemIds(
      pool,
      input.isWormholeSystem,
      input.indicatorPrefs,
      input.nowMs,
    );
    rows = rows.filter((s) => staleIds.has(s.mapSystemId));
  }
  return rows;
}