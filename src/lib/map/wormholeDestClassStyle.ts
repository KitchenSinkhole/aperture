/** WH destination class → experimental signature row accent class. */

const DEST_CLASS: Record<string, string> = {
  H: 'ap-sig-wh-dest-h',
  L: 'ap-sig-wh-dest-l',
  '0.0': 'ap-sig-wh-dest-n',
  NS: 'ap-sig-wh-dest-n',
  LS: 'ap-sig-wh-dest-h',
  HS: 'ap-sig-wh-dest-h',
  P: 'ap-sig-wh-dest-p',
  A: 'ap-sig-wh-dest-a',
  C1: 'ap-sig-wh-dest-c1',
  C2: 'ap-sig-wh-dest-c2',
  C3: 'ap-sig-wh-dest-c3',
  C4: 'ap-sig-wh-dest-c4',
  C5: 'ap-sig-wh-dest-c5',
  C6: 'ap-sig-wh-dest-c6',
};

export function wormholeDestClassRowClass(targetClass: string | null | undefined): string {
  if (!targetClass) return '';
  const key = targetClass.trim();
  const direct = DEST_CLASS[key];
  if (direct) return direct;
  const upper = key.toUpperCase();
  if (upper.startsWith('C') && /^C\d$/.test(upper)) {
    return DEST_CLASS[upper] ?? '';
  }
  return DEST_CLASS[upper] ?? '';
}
