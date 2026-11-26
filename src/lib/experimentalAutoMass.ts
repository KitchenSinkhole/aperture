import type { WhMass } from '@/lib/map/enumLabels';

/**
 * Maps remaining mass percent on a wormhole to mass status bands (Fresh >50%, Reduced <50%, Critical <10%).
 */
export function massStatusFromRemainingPercent(remainingPercent: number): WhMass {
  if (!Number.isFinite(remainingPercent)) return 'fresh';
  if (remainingPercent < 10) return 'critical';
  if (remainingPercent < 50) return 'reduced';
  return 'fresh';
}

/** Given jumped cumulative mass and total hole mass (kg), derive status or null when unknown. */
export function massStatusFromCumulative(
  cumulativeMassKg: number,
  totalMassKg: number | null,
): WhMass | null {
  if (totalMassKg == null || totalMassKg <= 0) return null;
  const usedPercent = (cumulativeMassKg / totalMassKg) * 100;
  const remaining = 100 - usedPercent;
  return massStatusFromRemainingPercent(remaining);
}
