import { describe, it, expect } from 'vitest';
import {
  abcStrategy,
  homeStaticExemptionChanges,
  isTaggableClass,
  letterForIndex,
  indexForLetter,
} from '@/lib/tagging/abc';
import { scheme0121Strategy } from '@/lib/tagging/scheme0121';
import type { TagContext, TagEdge, TagSystem } from '@/lib/tagging/types';

// Pure-strategy tests for the auto-tagging schemes. No db.

const sys = (id: number, securityClass: string | null, tag: string | null): TagSystem => ({
  mapSystemId: BigInt(id),
  systemId: 30000000 + id,
  tag,
  securityClass,
});

const abcCtx = (systems: TagSystem[]): TagContext => ({
  scheme: 'abc',
  homeMapSystemId: null,
  exemptHomeStatic: false,
  systems,
  connections: [],
});

describe('isTaggableClass', () => {
  it('is true for C1–C6 and C13', () => {
    for (const cls of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C13']) {
      expect(isTaggableClass(cls)).toBe(true);
    }
  });

  it('is false for named WH classes, k-space, and class-less systems', () => {
    for (const cls of ['C12', 'C14', 'C15', 'C16', 'C17', 'C18', 'H', 'L', '0.0', 'A', 'P', 'C7', '']) {
      expect(isTaggableClass(cls)).toBe(false);
    }
    expect(isTaggableClass(null)).toBe(false);
  });
});

describe('letterForIndex / indexForLetter', () => {
  it('maps ordinals to bijective base-26 letters at the boundaries', () => {
    expect(letterForIndex(0)).toBe('A');
    expect(letterForIndex(25)).toBe('Z');
    expect(letterForIndex(26)).toBe('AA');
    expect(letterForIndex(27)).toBe('AB');
    expect(letterForIndex(701)).toBe('ZZ');
    expect(letterForIndex(702)).toBe('AAA');
  });

  it('inverts letters back to ordinals', () => {
    expect(indexForLetter('A')).toBe(0);
    expect(indexForLetter('Z')).toBe(25);
    expect(indexForLetter('AA')).toBe(26);
    expect(indexForLetter('ZZ')).toBe(701);
    expect(indexForLetter('AAA')).toBe(702);
  });

  it('rejects non-letter tokens (e.g. 0121 numeric tags)', () => {
    for (const token of ['1', '11', '', 'a', 'A1', ' ']) {
      expect(indexForLetter(token)).toBeNull();
    }
  });

  it('round-trips ordinal → letter → ordinal', () => {
    for (let n = 0; n <= 1000; n++) {
      expect(indexForLetter(letterForIndex(n))).toBe(n);
    }
  });
});

describe('ABC strategy', () => {
  it('assigns the lowest free letter per class, independently', () => {
    expect(abcStrategy.tagOnAdd(abcCtx([]), sys(1, 'C1', null))).toBe('A');
    expect(abcStrategy.tagOnAdd(abcCtx([sys(1, 'C1', 'A')]), sys(2, 'C1', null))).toBe('B');
    expect(
      abcStrategy.tagOnAdd(
        abcCtx([sys(1, 'C1', 'A'), sys(2, 'C1', 'B'), sys(3, 'C1', 'C')]),
        sys(4, 'C1', null),
      ),
    ).toBe('D');
    // C2 keeps its own sequence regardless of C1.
    expect(abcStrategy.tagOnAdd(abcCtx([sys(1, 'C1', 'A')]), sys(2, 'C2', null))).toBe('A');
  });

  it('tags C13 shattered systems on their own sequence', () => {
    expect(abcStrategy.tagOnAdd(abcCtx([]), sys(1, 'C13', null))).toBe('A');
    expect(abcStrategy.tagOnAdd(abcCtx([sys(1, 'C13', 'A')]), sys(2, 'C13', null))).toBe('B');
    // C13 is independent of the C1–C6 sequences.
    expect(abcStrategy.tagOnAdd(abcCtx([sys(1, 'C1', 'A')]), sys(2, 'C13', null))).toBe('A');
  });

  it('reclaims a freed letter (lowest free, not next)', () => {
    // B is gone → the next C1 reclaims B, not D.
    expect(
      abcStrategy.tagOnAdd(abcCtx([sys(1, 'C1', 'A'), sys(3, 'C1', 'C')]), sys(4, 'C1', null)),
    ).toBe('B');
  });

  it('does not tag k-space / Abyssal / Pochven / named WH / class-less systems', () => {
    expect(abcStrategy.tagOnAdd(abcCtx([]), sys(1, 'H', null))).toBeNull();
    expect(abcStrategy.tagOnAdd(abcCtx([]), sys(2, 'L', null))).toBeNull();
    expect(abcStrategy.tagOnAdd(abcCtx([]), sys(3, '0.0', null))).toBeNull();
    expect(abcStrategy.tagOnAdd(abcCtx([]), sys(4, 'A', null))).toBeNull();
    expect(abcStrategy.tagOnAdd(abcCtx([]), sys(5, 'P', null))).toBeNull();
    expect(abcStrategy.tagOnAdd(abcCtx([]), sys(6, null, null))).toBeNull();
    // C13 is now taggable, but the other named holes (Thera, Drifters) stay skipped.
    for (const cls of ['C12', 'C14', 'C15', 'C16', 'C17', 'C18']) {
      expect(abcStrategy.tagOnAdd(abcCtx([]), sys(7, cls, null))).toBeNull();
    }
  });

  it('never tags the Home system even when its class is taggable', () => {
    const ctx: TagContext = {
      scheme: 'abc',
      homeMapSystemId: BigInt(1),
      exemptHomeStatic: false,
      systems: [sys(1, 'C5', null)],
      connections: [],
    };
    expect(abcStrategy.tagOnAdd(ctx, sys(1, 'C5', null))).toBeNull();
  });

  it('ignores other-class and untagged systems when picking the next letter', () => {
    const ctx = abcCtx([sys(1, 'C1', 'A'), sys(2, 'C13', 'A'), sys(3, 'C5', null)]);
    // C5 has no tagged sibling, so it starts at A despite the other classes.
    expect(abcStrategy.tagOnAdd(ctx, sys(4, 'C5', null))).toBe('A');
  });

  it('never tags on connect (topology is irrelevant for ABC)', () => {
    const ctx = abcCtx([sys(1, 'C3', 'A'), sys(2, 'C3', null)]);
    expect(
      abcStrategy.tagOnConnect(ctx, { source: sys(1, 'C3', 'A'), target: sys(2, 'C3', null) }),
    ).toBeNull();
  });

  it('continues past Z into multi-letter tokens', () => {
    const used = Array.from({ length: 26 }, (_, i) =>
      sys(i + 1, 'C1', String.fromCharCode(65 + i)),
    );
    expect(abcStrategy.tagOnAdd(abcCtx(used), sys(99, 'C1', null))).toBe('AA');
  });

  it('availableTags lists the next three free letters per class', () => {
    const out = abcStrategy.availableTags(abcCtx([sys(1, 'C1', 'A'), sys(2, 'C1', 'C')]), null);
    if (out.scheme !== 'abc') throw new Error('expected abc');
    const c1 = out.perClass.find((r) => r.classLabel === 'C1')!;
    expect(c1.next).toEqual(['B', 'D', 'E']);
    // C2 is in the always-shown grid even with no systems yet.
    const c2 = out.perClass.find((r) => r.classLabel === 'C2')!;
    expect(c2.next).toEqual(['A', 'B', 'C']);
  });

  it('availableTags grid is exactly C1–C6 — C13 is tagged but never shown', () => {
    // A tagged C13 system is on the map...
    const ctx = abcCtx([sys(1, 'C13', 'A')]);
    const out = abcStrategy.availableTags(ctx, null);
    if (out.scheme !== 'abc') throw new Error('expected abc');
    // ...yet the panel grid omits C13 (DEFAULT_ABC_CLASSES ≠ TAGGABLE_CLASSES)...
    expect(out.perClass.map((r) => r.classLabel)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6']);
    // ...while tagOnAdd still hands the next C13 its letter.
    expect(abcStrategy.tagOnAdd(ctx, sys(2, 'C13', null))).toBe('B');
  });

  it('availableTags ignores the selected-parent argument', () => {
    const ctx = abcCtx([sys(1, 'C1', 'A')]);
    expect(abcStrategy.availableTags(ctx, BigInt(1))).toEqual(abcStrategy.availableTags(ctx, null));
  });
});

const HOME = 100;

const chainCtx = (systems: TagSystem[]): TagContext => ({
  scheme: '0121',
  homeMapSystemId: BigInt(HOME),
  exemptHomeStatic: false,
  systems,
  connections: [],
});

describe('0121 strategy', () => {
  const home = sys(HOME, null, null);

  it('numbers the first hole off Home as 1', () => {
    const child = sys(1, 'C3', null);
    const out = scheme0121Strategy.tagOnConnect(chainCtx([home, child]), {
      source: home,
      target: child,
    });
    expect(out).toEqual({ mapSystemId: BigInt(1), tag: '1' });
  });

  it('appends the child index to the parent tag', () => {
    const parent = sys(1, 'C3', '1');
    const child = sys(2, 'C3', null);
    const out = scheme0121Strategy.tagOnConnect(chainCtx([home, parent, child]), {
      source: parent,
      target: child,
    });
    expect(out).toEqual({ mapSystemId: BigInt(2), tag: '11' });
  });

  it('numbers siblings in order and reclaims per-parent', () => {
    // Parent 1 already has child 11; the next child is 12.
    const parent = sys(1, 'C3', '1');
    const c11 = sys(2, 'C3', '11');
    const next = sys(3, 'C3', null);
    expect(
      scheme0121Strategy.tagOnConnect(chainCtx([home, parent, c11, next]), {
        source: parent,
        target: next,
      }),
    ).toEqual({ mapSystemId: BigInt(3), tag: '12' });

    // With 11 removed (only 12 remains visible), the next child reclaims 11.
    const c12 = sys(4, 'C3', '12');
    expect(
      scheme0121Strategy.tagOnConnect(chainCtx([home, parent, c12, next]), {
        source: parent,
        target: next,
      }),
    ).toEqual({ mapSystemId: BigInt(3), tag: '11' });
  });

  it('defers when the split is ambiguous or the child is already tagged', () => {
    const a = sys(1, 'C3', '1');
    const b = sys(2, 'C3', '11');
    // both tagged
    expect(scheme0121Strategy.tagOnConnect(chainCtx([home, a, b]), { source: a, target: b })).toBeNull();
    // both untagged
    const u1 = sys(3, 'C3', null);
    const u2 = sys(4, 'C3', null);
    expect(scheme0121Strategy.tagOnConnect(chainCtx([u1, u2]), { source: u1, target: u2 })).toBeNull();
  });

  it('never tags at add time', () => {
    expect(scheme0121Strategy.tagOnAdd(chainCtx([home]), sys(1, 'C3', null))).toBeNull();
  });

  it('availableTags shows Home next and the selected parent next', () => {
    const c1 = sys(1, 'C3', '1');
    const out = scheme0121Strategy.availableTags(chainCtx([home, c1]), BigInt(1));
    if (out.scheme !== '0121') throw new Error('expected 0121');
    const homeRow = out.perParent.find((r) => r.parentLabel === 'Home')!;
    expect(homeRow.next).toBe('2'); // 1 is taken
    const parentRow = out.perParent.find((r) => r.parentLabel === '1')!;
    expect(parentRow.next).toBe('11');
  });
});

const STATIC_HOME = 100;
const edge = (source: number, target: number, isStatic: boolean): TagEdge => ({
  source: BigInt(source),
  target: BigInt(target),
  isStatic,
});

const exemptCtx = (
  systems: TagSystem[],
  connections: TagEdge[],
  exemptHomeStatic: boolean,
): TagContext => ({
  scheme: 'abc',
  homeMapSystemId: BigInt(STATIC_HOME),
  exemptHomeStatic,
  systems,
  connections,
});

describe('ABC home-static exemption', () => {
  // Home is k-space here so it is never itself taggable (keeps the C5 letter
  // math about the static target / siblings only).
  const home = sys(STATIC_HOME, 'H', null);

  it('clears the tag of the Home static target and frees its letter', () => {
    const target = sys(1, 'C5', 'A');
    const other = sys(2, 'C5', 'B');
    const changes = homeStaticExemptionChanges(
      exemptCtx([home, target, other], [edge(STATIC_HOME, 1, true)], true),
    );
    expect(changes).toContainEqual({ mapSystemId: BigInt(1), tag: null });
    // `other` keeps B; the freed A is not reassigned to an already-tagged system.
    expect(changes).not.toContainEqual({ mapSystemId: BigInt(2), tag: expect.anything() });
  });

  it('matches the static regardless of edge direction', () => {
    const target = sys(1, 'C3', 'A');
    const changes = homeStaticExemptionChanges(
      exemptCtx([home, target], [edge(1, STATIC_HOME, true)], true),
    );
    expect(changes).toEqual([{ mapSystemId: BigInt(1), tag: null }]);
  });

  it('re-tags the formerly-exempt system when the toggle is off (reclaims lowest free)', () => {
    // target untagged (was exempt), other holds B → target reclaims A.
    const target = sys(1, 'C5', null);
    const other = sys(2, 'C5', 'B');
    const changes = homeStaticExemptionChanges(
      exemptCtx([home, target, other], [edge(STATIC_HOME, 1, true)], false),
    );
    expect(changes).toEqual([{ mapSystemId: BigInt(1), tag: 'A' }]);
  });

  it('re-tags when the static flag is removed even with the toggle on', () => {
    const target = sys(1, 'C5', null);
    const changes = homeStaticExemptionChanges(
      exemptCtx([home, target], [edge(STATIC_HOME, 1, false)], true),
    );
    expect(changes).toEqual([{ mapSystemId: BigInt(1), tag: 'A' }]);
  });

  it('ignores a static that does not touch Home', () => {
    const a = sys(1, 'C5', 'A');
    const b = sys(2, 'C5', 'B');
    const changes = homeStaticExemptionChanges(
      exemptCtx([home, a, b], [edge(1, 2, true)], true),
    );
    expect(changes).toEqual([]);
  });

  it('does nothing for a non-ABC snapshot', () => {
    const ctx: TagContext = {
      scheme: '0121',
      homeMapSystemId: BigInt(STATIC_HOME),
      exemptHomeStatic: true,
      systems: [home, sys(1, 'C5', '1')],
      connections: [edge(STATIC_HOME, 1, true)],
    };
    expect(homeStaticExemptionChanges(ctx)).toEqual([]);
  });

  it('clears every Home-static target in one pass', () => {
    const t1 = sys(1, 'C5', 'A');
    const t2 = sys(2, 'C5', 'B');
    const changes = homeStaticExemptionChanges(
      exemptCtx([home, t1, t2], [edge(STATIC_HOME, 1, true), edge(STATIC_HOME, 2, true)], true),
    );
    expect(changes).toContainEqual({ mapSystemId: BigInt(1), tag: null });
    expect(changes).toContainEqual({ mapSystemId: BigInt(2), tag: null });
  });

  it('never tags or exempts the Home system even when its class is taggable', () => {
    // Home is C5 here (taggable), behind its own static to a C5 target.
    const taggableHome = sys(STATIC_HOME, 'C5', null);
    const target = sys(1, 'C5', 'A');
    const changes = homeStaticExemptionChanges(
      exemptCtx([taggableHome, target], [edge(STATIC_HOME, 1, true)], true),
    );
    // Only the target is cleared; Home gets neither a tag nor an exemption entry.
    expect(changes).toEqual([{ mapSystemId: BigInt(1), tag: null }]);
  });

  it('leaves a non-taggable Home-static target untouched', () => {
    const target = sys(1, 'H', null);
    const changes = homeStaticExemptionChanges(
      exemptCtx([home, target], [edge(STATIC_HOME, 1, true)], true),
    );
    expect(changes).toEqual([]);
  });

  it('fills any untagged taggable system (self-healing) regardless of exemption', () => {
    const tagged = sys(1, 'C5', 'A');
    const hole = sys(2, 'C5', null);
    const changes = homeStaticExemptionChanges(
      exemptCtx([home, tagged, hole], [], false),
    );
    // The hole reclaims the lowest free letter (B); the tagged one is left alone.
    expect(changes).toEqual([{ mapSystemId: BigInt(2), tag: 'B' }]);
  });

  it('does not emit a spurious clear for an already-untagged exempt system', () => {
    const target = sys(1, 'C5', null);
    const changes = homeStaticExemptionChanges(
      exemptCtx([home, target], [edge(STATIC_HOME, 1, true)], true),
    );
    expect(changes).toEqual([]);
  });
});
