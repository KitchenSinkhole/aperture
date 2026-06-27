import { Plus, type LucideProps } from 'lucide-react';

/**
 * The app-wide glyph for a Cosmic Signature (a scanner entry that must be
 * probed/scanned down). Thin wrapper over a Lucide icon so the chosen glyph can
 * be swapped in one place. Defaults to the signature red (`#E30001`); forwards
 * `className`/size and any `color` override so callers control appearance.
 */
export function SignatureIcon(props: LucideProps) {
  return (
    <Plus aria-label="Signature" color="#E30001" {...props}>
      <title>Signature</title>
    </Plus>
  );
}
