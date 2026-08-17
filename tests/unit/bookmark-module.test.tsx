import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookmarkModule, resolveBookmarkTransit } from '@/components/sidebar/BookmarkModule';
import type { BookmarkInput, MapConnectionEdge, MapSignature, MapSystemNode } from '@/types';

// Must be declared before the imports that depend on them — Vitest hoists vi.mock calls.
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// Capture the traversal callback the component registers so the test can fire
// a jump at it directly, standing in for a `characterUpdate` from the
// presence store (mirrors tests/unit/transitSignaturePrompt.test.tsx).
let traversalCb:
  | ((t: { characterId: number; fromSystemId: number; toSystemId: number; at: string }) => void)
  | null = null;
vi.mock('@/components/map/MapPresenceContext', () => ({
  useTraversals: (cb: typeof traversalCb) => {
    traversalCb = cb;
  },
}));

// Deterministic stand-in for the real reference scheme — full field coverage
// of `BookmarkInput` is exercised by tests/unit/bookmarking-reference.test.ts;
// this file only needs a scheme whose output is easy to assert against.
const { namesMock } = vi.hoisted(() => ({ namesMock: vi.fn() }));
vi.mock('@/lib/bookmarking/scheme', () => ({
  effectiveBookmarkScheme: { names: (input: unknown) => namesMock(input) },
}));

const HOME = 1;
const SOURCE = 100;
const DEST = 200;

function system(id: string, systemId: number, name: string): MapSystemNode {
  return { id, systemId, name, alias: null } as unknown as MapSystemNode;
}

function connection(
  id: string,
  source: string,
  target: string,
  scope: 'wh' | 'stargate' = 'wh',
): MapConnectionEdge {
  return { id, source, target, scope } as unknown as MapConnectionEdge;
}

function sig(overrides: { id: string; mapSystemId: string; mapConnectionId: string | null }): MapSignature {
  return {
    sigId: 'ABC-123',
    groupKey: 'wormhole',
    classKind: null,
    activityOverride: null,
    typeId: null,
    eolStage: 'none',
    wormholeCode: null,
    name: null,
    description: null,
    expiresAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as MapSignature;
}

const systems = [system('src', SOURCE, 'J111111'), system('dst', DEST, 'J222222')];
const viewerCharacters = [{ id: 1, name: 'Pilot One' }];
const whConnection = connection('conn-wh', 'src', 'dst', 'wh');

/** Default fake scheme: deterministic, and long enough (80+ chars) to stand in for the reference scheme's oversized names. */
function defaultNames(input: BookmarkInput) {
  return {
    here: `BOOKMARK::${input.here.id}::sigs=${input.signatures.length}::${'X'.repeat(80)}`,
    cameFrom: `BOOKMARK::${input.cameFrom.id}::sigs=${input.signatures.length}::${'Y'.repeat(80)}`,
  };
}

let container: HTMLDivElement;
let root: Root;
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  traversalCb = null;
  namesMock.mockReset();
  namesMock.mockImplementation(defaultNames);
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function render(props: {
  connections: MapConnectionEdge[];
  signatures?: MapSignature[];
  systems?: MapSystemNode[];
  homeMapSystemId?: string | null;
}) {
  act(() => {
    root.render(
      <BookmarkModule
        systems={props.systems ?? systems}
        connections={props.connections}
        signatures={props.signatures ?? []}
        homeMapSystemId={props.homeMapSystemId ?? null}
        viewerCharacters={viewerCharacters}
      />,
    );
  });
}

function fireJump(characterId = 1) {
  act(() => {
    traversalCb?.({ characterId, fromSystemId: SOURCE, toSystemId: DEST, at: '2026-01-01T00:00:00.000Z' });
  });
}

describe('BookmarkModule', () => {
  it('shows the empty state before any transit', () => {
    render({ connections: [] });
    expect(container.textContent).toContain('Jump through a wormhole');
    expect(namesMock).not.toHaveBeenCalled();
  });

  it('renders the labelled pair on a traversal by one of viewerCharacters', () => {
    render({ connections: [whConnection] });
    fireJump();

    expect(container.textContent).toContain('J222222'); // here (jumped into)
    expect(container.textContent).toContain('J111111'); // cameFrom
    expect(namesMock).toHaveBeenCalledTimes(1);
    const input = namesMock.mock.calls[0]![0] as BookmarkInput;
    expect(input.here.id).toBe('dst');
    expect(input.cameFrom.id).toBe('src');
    expect(input.connection.id).toBe('conn-wh');
  });

  it('ignores a traversal by a character not in viewerCharacters', () => {
    render({ connections: [whConnection] });
    fireJump(999);
    expect(container.textContent).toContain('Jump through a wormhole');
    expect(namesMock).not.toHaveBeenCalled();
  });

  it('renders the empty state while the wh connection has not folded, then resolves once it lands', () => {
    render({ connections: [] });
    fireJump();
    expect(container.textContent).toContain('Jump through a wormhole');
    expect(namesMock).not.toHaveBeenCalled();

    render({ connections: [whConnection] });
    expect(container.textContent).toContain('J222222');
    expect(namesMock).toHaveBeenCalledTimes(1);
  });

  it('forgets a buffered jump that never folds within the 3s buffer', () => {
    vi.useFakeTimers();
    render({ connections: [] });
    fireJump();
    expect(container.textContent).toContain('Jump through a wormhole');

    // The buffer TTL elapses with no fold — the jump is forgotten.
    act(() => vi.advanceTimersByTime(3100));

    // Even though the connection now lands, the forgotten jump never resolves.
    render({ connections: [whConnection] });
    expect(container.textContent).toContain('Jump through a wormhole');
    expect(namesMock).not.toHaveBeenCalled();
  });

  // This test's discriminating power was verified by hand: with the
  // component's `snapshot` hold removed (re-deriving `here`/`cameFrom`/
  // `connections`/`hopsFromHome` live every render instead of freezing them),
  // this test fails — the pair picks up "RENAMED", the halved hop count, and
  // the grown connection count. See
  // .superpowers/sdd/bookmarking-engine/stage-4-report.md and
  // stage-4b-report.md for the falsification runs.
  it('keeps the displayed pair unchanged after a graph change that would alter a re-derivation', () => {
    const home = system('home', HOME, 'Home');
    const connHomeSrc = connection('conn-home-src', 'home', 'src', 'wh');
    namesMock.mockImplementation((input: BookmarkInput) => ({
      here: `${input.here.alias ?? input.here.name}::hops=${input.hopsFromHome.get(input.here.id) ?? 'none'}::conns=${input.connections.length}`,
      cameFrom: `${input.cameFrom.alias ?? input.cameFrom.name}::hops=${input.hopsFromHome.get(input.cameFrom.id) ?? 'none'}::conns=${input.connections.length}`,
    }));

    render({
      connections: [connHomeSrc, whConnection],
      systems: [home, ...systems],
      homeMapSystemId: 'home',
    });
    fireJump();
    const before = container.textContent;
    expect(before).toContain('J222222::hops=2::conns=2'); // here, via home->src->dst
    expect(before).toContain('J111111::hops=1::conns=2'); // cameFrom, via home->src

    // Rename the "here" system and add a home->dst shortcut that would halve
    // its hop count and grow the connection count — both would show up
    // immediately if the pair were re-derived from live props instead of held.
    const dstRenamed = system('dst', DEST, 'RENAMED');
    const shortcut = connection('conn-shortcut', 'home', 'dst', 'wh');
    render({
      connections: [connHomeSrc, whConnection, shortcut],
      systems: [home, systems[0]!, dstRenamed],
      homeMapSystemId: 'home',
    });

    expect(container.textContent).toBe(before);
    expect(container.textContent).not.toContain('RENAMED');
    expect(container.textContent).not.toContain('conns=3');
  });

  it("refreshes the pair when a signature bound to this hole's connection changes", () => {
    render({ connections: [whConnection], signatures: [] });
    fireJump();
    const before = container.textContent;
    expect(before).toContain('sigs=0');

    const boundSig = sig({ id: 'sig-1', mapSystemId: 'src', mapConnectionId: 'conn-wh' });
    render({ connections: [whConnection], signatures: [boundSig] });

    expect(container.textContent).not.toBe(before);
    expect(container.textContent).toContain('sigs=1');
  });

  it('leaves the pair unchanged when a signature is bound to a different connection', () => {
    render({ connections: [whConnection], signatures: [] });
    fireJump();
    const before = container.textContent;
    expect(before).toContain('sigs=0');

    const extraSystem = system('extra', 300, 'J333333');
    const otherConn = connection('conn-other', 'dst', 'extra', 'wh');
    const unrelatedSig = sig({ id: 'sig-2', mapSystemId: 'dst', mapConnectionId: 'conn-other' });
    render({
      connections: [whConnection, otherConn],
      systems: [...systems, extraSystem],
      signatures: [unrelatedSig],
    });

    expect(container.textContent).toBe(before);
    expect(container.textContent).toContain('sigs=0');
  });

  it('shows a hint, not a disabled control, when the scheme returns null', () => {
    namesMock.mockImplementation(() => null);
    render({ connections: [whConnection] });
    fireJump();

    expect(container.textContent).toContain('no name for this wormhole');
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelector('button[disabled]')).toBeNull();
  });

  it('copies the full untruncated name from each row copy button', async () => {
    render({ connections: [whConnection] });
    fireJump();

    const buttons = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
    expect(buttons).toHaveLength(2);

    act(() => buttons[0]!.click());
    await act(async () => {});
    const hereCopied = writeText.mock.calls[0]![0] as string;
    expect(hereCopied).toBe(`BOOKMARK::dst::sigs=0::${'X'.repeat(80)}`);
    expect(hereCopied.length).toBeGreaterThan(80);

    act(() => buttons[1]!.click());
    await act(async () => {});
    const cameFromCopied = writeText.mock.calls[1]![0] as string;
    expect(cameFromCopied).toBe(`BOOKMARK::src::sigs=0::${'Y'.repeat(80)}`);

    // Full string also carried in the row's title (display clips via CSS, not the string itself).
    const titled = Array.from(container.querySelectorAll('[title]'));
    expect(titled.map((el) => el.getAttribute('title'))).toEqual([hereCopied, cameFromCopied]);
  });
});

describe('resolveBookmarkTransit', () => {
  it('resolves the wh connection between the two systems', () => {
    const result = resolveBookmarkTransit({ fromSystemId: SOURCE, toSystemId: DEST }, systems, [whConnection]);
    expect(result).toEqual({
      kind: 'resolved',
      here: systems[1],
      cameFrom: systems[0],
      connection: whConnection,
    });
  });

  it('drops a gate jump (a stargate connection between the two systems)', () => {
    const gate = connection('conn-gate', 'src', 'dst', 'stargate');
    const result = resolveBookmarkTransit({ fromSystemId: SOURCE, toSystemId: DEST }, systems, [gate]);
    expect(result).toEqual({ kind: 'drop' });
  });

  it('is pending when one of the endpoint systems is not yet on the map', () => {
    const result = resolveBookmarkTransit({ fromSystemId: SOURCE, toSystemId: 999999 }, systems, []);
    expect(result).toEqual({ kind: 'pending' });
  });

  it('is pending when both systems are on the map but no connection links them yet', () => {
    const result = resolveBookmarkTransit({ fromSystemId: SOURCE, toSystemId: DEST }, systems, []);
    expect(result).toEqual({ kind: 'pending' });
  });
});
