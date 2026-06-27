import { Circle, type LucideProps } from 'lucide-react';

/**
 * The app-wide glyph for a Cosmic Anomaly (a scanner entry that is instantly
 * warpable, no scanning needed). Thin wrapper over a Lucide icon so the chosen
 * glyph can be swapped in one place. Defaults to the anomaly green (`#34CC37`);
 * forwards `className`/size and any `color` override so callers control appearance.
 */
export function AnomalyIcon(props: LucideProps) {
  return (
    <Circle aria-label="Anomaly" color="#34cc37" {...props}>
      <title>Anomaly</title>
    </Circle>
  );
}
