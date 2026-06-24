// Scheme A "ABC". Each WH class carries its own independent
// sequence of letters (A, B, C, …); the lowest free letter is always assigned,
// so deleting a tagged system reclaims its letter. K-space and class-less
// systems are not tagged. Pure / db-free.

import type { AvailableTags, TagContext, TagStrategy, TagSystem } from './types';

/**
 * The ABC home-static exemption, as a pure function over a tag snapshot. Returns
 * the tag changes so the system reached by the Home's static connection
 * (`TagEdge.isStatic`, when `ctx.exemptHomeStatic` is on) is left untagged (its
 * letter freed for reclaim) and every other taggable system keeps the lowest
 * free letter for its class. `[]` for non-ABC snapshots.
 *
 * Self-healing: it clears the exempt system's tag and fills any other taggable
 * system's empty tag. Under ABC every taggable system is normally tagged, so the
 * only hole is the system that just lost its exemption (toggle off, static
 * unmarked/deleted, or Home moved) — which gets re-tagged here. The db-aware
 * wrapper is `reconcileHomeStaticExemption` in `service.ts`.
 */
export function homeStaticExemptionChanges(
  ctx: TagContext,
): { mapSystemId: bigint; tag: string | null }[] {
  if (ctx.scheme !== 'abc') return [];

  // The exempt set: non-Home endpoints of static connections that touch Home.
  const exempt = new Set<bigint>();
  if (ctx.exemptHomeStatic && ctx.homeMapSystemId != null) {
    const home = ctx.homeMapSystemId;
    for (const e of ctx.connections) {
      if (!e.isStatic) continue;
      if (e.source === home) exempt.add(e.target);
      else if (e.target === home) exempt.add(e.source);
    }
  }

  // Per-class used-letter ordinals from currently-tagged systems, EXCLUDING the
  // exempt ones (their tags are about to be cleared, freeing those letters).
  const usedByClass = new Map<string, Set<number>>();
  for (const s of ctx.systems) {
    if (!isTaggableClass(s.securityClass) || !s.tag || exempt.has(s.mapSystemId)) continue;
    const idx = indexForLetter(s.tag);
    if (idx == null) continue;
    let set = usedByClass.get(s.securityClass);
    if (!set) usedByClass.set(s.securityClass, (set = new Set<number>()));
    set.add(idx);
  }

  const takeLowestFree = (cls: string): string => {
    let set = usedByClass.get(cls);
    if (!set) usedByClass.set(cls, (set = new Set<number>()));
    let i = 0;
    while (set.has(i)) i++;
    set.add(i);
    return letterForIndex(i);
  };

  const changes: { mapSystemId: bigint; tag: string | null }[] = [];
  for (const s of ctx.systems) {
    if (!isTaggableClass(s.securityClass)) continue;
    if (ctx.homeMapSystemId != null && s.mapSystemId === ctx.homeMapSystemId) continue;
    if (exempt.has(s.mapSystemId)) {
      if (s.tag !== null) changes.push({ mapSystemId: s.mapSystemId, tag: null });
    } else if (s.tag == null) {
      changes.push({ mapSystemId: s.mapSystemId, tag: takeLowestFree(s.securityClass) });
    }
  }
  return changes;
}

/** Canonical WH classes always shown in the panel grid, even before discovery. C13 omitted as it's rare */
const DEFAULT_ABC_CLASSES = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'];

const TAGGABLE_CLASSES = new Set(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C13']);

/**
 * True for a security label that gets its own ABC letter sequence.
 * Only C1–C6, and C13 are tagged; Drifter holes, Thera and k-space systems are
 * all named and skipped.
 */
export function isTaggableClass(securityClass: string | null): securityClass is string {
  return securityClass != null && TAGGABLE_CLASSES.has(securityClass);
}

/** 0 → "A", 25 → "Z", 26 → "AA", 27 → "AB", … (bijective base-26, spreadsheet-column style). */
export function letterForIndex(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** Inverse of `letterForIndex`. "A" → 0, "AA" → 26. Returns null for a non-letter token. */
export function indexForLetter(token: string): number | null {
  if (!/^[A-Z]+$/.test(token)) return null;
  let n = 0;
  for (const ch of token) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** The set of letter ordinals currently used by visible systems of `classLabel`. */
function usedIndicesForClass(ctx: TagContext, classLabel: string): Set<number> {
  const used = new Set<number>();
  for (const s of ctx.systems) {
    if (s.securityClass !== classLabel || !s.tag) continue;
    const idx = indexForLetter(s.tag);
    if (idx != null) used.add(idx);
  }
  return used;
}

/** The lowest `count` free letter ordinals for a class, as letter tokens. */
function lowestFreeLetters(used: Set<number>, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < count; i++) {
    if (!used.has(i)) out.push(letterForIndex(i));
  }
  return out;
}

export const abcStrategy: TagStrategy = {
  tagOnAdd(ctx: TagContext, subject: TagSystem): string | null {
    if (!isTaggableClass(subject.securityClass)) return null;
    if (ctx.homeMapSystemId != null && subject.mapSystemId === ctx.homeMapSystemId) return null;
    const used = usedIndicesForClass(ctx, subject.securityClass);
    return lowestFreeLetters(used, 1)[0]!;
  },

  // ABC assigns purely from class at add time; topology is irrelevant.
  tagOnConnect() {
    return null;
  },

  availableTags(ctx: TagContext): AvailableTags {
    return {
      scheme: 'abc',
      perClass: DEFAULT_ABC_CLASSES.map((classLabel) => ({
        classLabel,
        next: lowestFreeLetters(usedIndicesForClass(ctx, classLabel), 3),
      })),
    };
  },
};
