import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookmarkModule } from '@/components/sidebar/BookmarkModule';
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

  it('keeps the displayed pair unchanged after an unrelated graph change', () => {
    render({ connections: [whConnection] });
    fireJump();
    const before = container.textContent;

    const extraSystem = system('extra', 300, 'J333333');
    const unrelatedConn = connection('conn-unrelated', 'dst', 'extra', 'wh');
    render({ connections: [whConnection, unrelatedConn], systems: [...systems, extraSystem] });

    expect(container.textContent).toBe(before);
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
