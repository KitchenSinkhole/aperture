import type {
  RouteHop,
  RouteInstructionToken,
  RoutePlan,
  RouteSegment,
  RouteSegmentPoint,
  RouteSpaceKind,
} from '@/types';

/**
 * Route segmentation (routes-module). Groups a plan's flat `RouteHop[]` into the
 * runs a pilot would actually narrate — a gate burn, a chain traversal, a
 * wormhole entry or exit — and renders each as one instruction line.
 *
 * Pure and DB-free: importable from both the server and the browser, and driven
 * directly by the unit tests.
 */

const WH_CLASS_RE = /^C\d+$/;
const J_NAME_RE = /^J\d{6}$/;

/**
 * Which kind of space a system sits in, from its `universe_system.security`
 * label with the `J######` name form as a fallback. Thera is `C12` and shattered
 * systems are `C13`, so the class pattern already covers them; Turnur is genuine
 * K-space despite being an EVE-Scout hub, and is deliberately not special-cased.
 */
export function routeSpaceKind(security: string | null, name: string): RouteSpaceKind {
  if (security === 'P') return 'pochven';
  if (security === 'A') return 'abyssal';
  if (security != null && WH_CLASS_RE.test(security)) return 'jspace';
  if (J_NAME_RE.test(name)) return 'jspace';
  if (security === 'H' || security === 'L' || security === '0.0') return 'kspace';
  return 'unknown';
}

/**
 * How a pilot refers to the system: a tagged J-space system by its class and tag
 * together (class `C1` + tag `B` reads `C1B`, matching the stacked pair on the
 * map tile), anything else by its real name.
 */
function labelFor(hop: RouteHop, space: RouteSpaceKind): string {
  if (space === 'jspace' && hop.tag) return `${hop.security ?? ''}${hop.tag}`;
  return hop.name;
}

function pointAt(hops: RouteHop[], index: number): RouteSegmentPoint {
  const hop = hops[index]!;
  const space = routeSpaceKind(hop.security, hop.name);
  return {
    hopIndex: index,
    systemId: hop.systemId,
    label: labelFor(hop, space),
    name: hop.name,
    security: hop.security,
    securityStatus: hop.securityStatus,
    space,
  };
}

function segment(
  hops: RouteHop[],
  kind: RouteSegment['kind'],
  fromHopIndex: number,
  toHopIndex: number,
  extra: Partial<RouteSegment> = {},
): RouteSegment {
  return {
    kind,
    fromHopIndex,
    toHopIndex,
    from: pointAt(hops, fromHopIndex),
    to: pointAt(hops, toHopIndex),
    jumps: toHopIndex - fromHopIndex,
    through: null,
    entrySigId: null,
    exitSigId: null,
    direction: null,
    ...extra,
  };
}

function whDirection(from: RouteSpaceKind, to: RouteSpaceKind): RouteSegment['direction'] {
  if (to === 'jspace' && from !== 'jspace') return 'enter';
  if (from === 'jspace' && to !== 'jspace') return 'exit';
  return 'lateral';
}

/**
 * Group a plan's hops into navigational segments, in travel order.
 *
 * A run of consecutive gate jumps collapses into one `gate_run` regardless of
 * security band or region crossings — a pilot burning to Jita reads that as one
 * instruction. Consecutive wormhole jumps that stay inside J-space collapse into
 * a `chain_run`. Any other wormhole jump is its own `wh_jump`, and an adjacent
 * enter/exit pair collapses into a `wh_transit`: the one-system shortcut idiom
 * where you dive a hole and immediately leave through another.
 *
 * **Returns:** one segment per instruction; `[]` when the plan is unreachable.
 * Segment index ranges tile `plan.hops` end to end, so a renderer can map any
 * hop back to the segment covering it.
 */
export function segmentRoute(plan: RoutePlan): RouteSegment[] {
  if (!plan.reachable || plan.hops.length === 0) return [];
  const hops = plan.hops;
  if (hops.length === 1) return [segment(hops, 'origin_only', 0, 0)];

  const segments: RouteSegment[] = [];
  for (let i = 1; i < hops.length; i++) {
    const hop = hops[i]!;
    const prev = hops[i - 1]!;
    const open = segments[segments.length - 1];

    if (hop.via === 'gate') {
      if (open?.kind === 'gate_run' && open.toHopIndex === i - 1) {
        segments[segments.length - 1] = segment(hops, 'gate_run', open.fromHopIndex, i);
      } else {
        segments.push(segment(hops, 'gate_run', i - 1, i));
      }
      continue;
    }

    if (hop.via === 'wh') {
      const fromSpace = routeSpaceKind(prev.security, prev.name);
      const toSpace = routeSpaceKind(hop.security, hop.name);
      const withinChain = fromSpace === 'jspace' && toSpace === 'jspace';
      if (withinChain && open?.kind === 'chain_run' && open.toHopIndex === i - 1) {
        segments[segments.length - 1] = segment(hops, 'chain_run', open.fromHopIndex, i, {
          // A multi-jump chain run reports its endpoints only, so the entry sig
          // stops being meaningful once a second jump joins it.
          entrySigId: null,
        });
      } else if (withinChain) {
        segments.push(segment(hops, 'chain_run', i - 1, i, { entrySigId: hop.viaSigId }));
      } else {
        segments.push(
          segment(hops, 'wh_jump', i - 1, i, {
            entrySigId: hop.viaSigId,
            direction: whDirection(fromSpace, toSpace),
          }),
        );
      }
      continue;
    }

    segments.push(segment(hops, hop.via === 'jumpbridge' ? 'jumpbridge' : 'eve_scout', i - 1, i));
  }

  return mergeTransits(hops, segments);
}

/**
 * Collapse a two-hop hop-through into one instruction.
 *
 * For wormholes that is an `enter` immediately followed by an `exit`; their
 * adjacency is exactly the "passed through a single J-space system" condition,
 * so no length threshold is needed. For EVE-Scout it is any two consecutive
 * `eve_scout` hops, which necessarily meet at a hub — keyed on the edge kind
 * rather than the space either side, since Thera is J-space but Turnur is
 * lowsec K-space and both transit the same way.
 */
function mergeTransits(hops: RouteHop[], segments: RouteSegment[]): RouteSegment[] {
  const merged: RouteSegment[] = [];
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i]!;
    const b = segments[i + 1];
    const adjacent = b != null && b.fromHopIndex === a.toHopIndex;

    if (
      adjacent &&
      a.kind === 'wh_jump' &&
      a.direction === 'enter' &&
      b.kind === 'wh_jump' &&
      b.direction === 'exit'
    ) {
      merged.push(
        segment(hops, 'wh_transit', a.fromHopIndex, b.toHopIndex, {
          through: a.to,
          entrySigId: a.entrySigId,
          exitSigId: b.entrySigId,
        }),
      );
      i++;
      continue;
    }

    if (adjacent && a.kind === 'eve_scout' && b.kind === 'eve_scout') {
      merged.push(
        segment(hops, 'eve_scout_transit', a.fromHopIndex, b.toHopIndex, { through: a.to }),
      );
      i++;
      continue;
    }

    merged.push(a);
  }
  return merged;
}

const UNSCANNED = 'an unscanned sig';

const t = (text: string): RouteInstructionToken => ({ kind: 'text', text });
const sys = (point: RouteSegmentPoint): RouteInstructionToken => ({
  kind: 'system',
  text: point.label,
  point,
});

/** `via BSA`, or the plain-text placeholder when nothing was scanned. */
function via(sigId: string | null): RouteInstructionToken[] {
  return [t('via '), sigId ? { kind: 'sig', text: sigId } : t(UNSCANNED)];
}

function jumpCount(n: number): string {
  return `${n} ${n === 1 ? 'jump' : 'jumps'}`;
}

/**
 * One segment as an ordered token list — the single source of the instruction
 * wording, shared by the on-screen render and the clipboard text.
 */
export function routeSegmentTokens(seg: RouteSegment): RouteInstructionToken[] {
  const from = sys(seg.from);
  const to = sys(seg.to);
  const through = seg.through ? sys(seg.through) : t('?');
  switch (seg.kind) {
    case 'origin_only':
      return [t('You are already in '), from, t('.')];
    case 'gate_run':
      return seg.jumps === 1
        ? [t('In '), from, t(', gate to '), to, t('.')]
        : [t('In '), from, t(`, burn ${jumpCount(seg.jumps)} to `), to, t('.')];
    case 'chain_run':
      return seg.jumps === 1
        ? [t('In '), from, t(', follow the chain to '), to, t(' '), ...via(seg.entrySigId), t('.')]
        : [t('In '), from, t(`, follow the chain ${jumpCount(seg.jumps)} to `), to, t('.')];
    case 'wh_jump': {
      const verb =
        seg.direction === 'enter' ? ', enter ' : seg.direction === 'exit' ? ', exit to ' : ', jump to ';
      return [t('In '), from, t(verb), to, t(' '), ...via(seg.entrySigId), t('.')];
    }
    case 'wh_transit':
      return [
        t('In '),
        from,
        t(', enter '),
        through,
        t(' '),
        ...via(seg.entrySigId),
        t(', then exit to '),
        to,
        t(' '),
        ...via(seg.exitSigId),
        t('.'),
      ];
    case 'jumpbridge':
      return [t('In '), from, t(', take the jumpbridge to '), to, t('.')];
    case 'eve_scout':
      return [t('In '), from, t(', take the EVE-Scout connection to '), to, t('.')];
    case 'eve_scout_transit':
      return [
        t('In '),
        from,
        t(', use EVE-Scout to transit through '),
        through,
        t(' to '),
        to,
        t('.'),
      ];
  }
}

/**
 * Render one segment as a single plain-text instruction, e.g.
 * `In Amarr, enter C5A via BSA, then exit to Jita via SOF.` A wormhole with no
 * recorded signature reads `via an unscanned sig` rather than dropping the
 * clause.
 */
export function formatRouteSegment(seg: RouteSegment): string {
  return routeSegmentTokens(seg)
    .map((tok) => tok.text)
    .join('');
}

/**
 * The whole route as a `Route <origin> -> <destination>` header followed by one
 * numbered step per line — the clipboard form, ready to paste into in-game chat.
 * Returns `''` for an empty segment list.
 */
export function formatRouteInstructions(segments: RouteSegment[]): string {
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (!first || !last) return '';
  const header = `Route ${first.from.label} -> ${last.to.label}`;
  const steps = segments.map((s, i) => `${i + 1}. ${formatRouteSegment(s)}`);
  return [header, ...steps].join('\n');
}
