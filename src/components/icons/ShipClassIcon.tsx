import { SHIP_CLASS_LABELS } from '@/lib/eve/shipClass';
import type { ShipClass } from '@/types';

/**
 * 16px hull-class icon for a pilot's ship, e.g. next to "Phoenix" in the
 * pilot roster. Renders a `bg-muted` placeholder square when `shipClass` is
 * null (unresolved ship type, or offline before the first online tick).
 */
export function ShipClassIcon({
  shipClass,
  className,
}: {
  shipClass: ShipClass | null;
  className?: string;
}) {
  if (shipClass === null) {
    return <span className={`inline-block size-4 shrink-0 rounded-sm bg-muted ${className ?? ''}`} />;
  }
  return (
    <img
      src={`/ship-icons/${shipClass}.png`}
      alt={SHIP_CLASS_LABELS[shipClass]}
      title={SHIP_CLASS_LABELS[shipClass]}
      width={16}
      height={16}
      className={`inline-block size-4 max-w-none shrink-0 ${className ?? ''}`}
    />
  );
}
