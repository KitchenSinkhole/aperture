// Display-side tagging helpers. Pure and db-free, importable from the browser.

import type { TagScheme } from '@/types';

/**
 * The single-line label for a system's class band and auto-tag, as the dense
 * sidebar tables render it (the map tile stacks the two, so it has no
 * ambiguity to resolve).
 *
 * ABC's tags are letters, so `C2` + `G` reads unambiguously as `C2G`. The 0121
 * scheme's tags are themselves numeric, and a concatenation cannot be split
 * back apart: `C32` is both a C3 tagged `2` and a hypothetical class 32. Those
 * maps therefore show the tag alone, falling back to the class band while a
 * system is still untagged.
 */
export function classTagLabel(
  security: string | null | undefined,
  tag: string | null | undefined,
  scheme: TagScheme,
): string {
  if (scheme === '0121') return tag || security || '';
  return [security, tag].filter(Boolean).join('');
}
