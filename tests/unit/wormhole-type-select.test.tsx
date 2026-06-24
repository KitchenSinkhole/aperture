import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@/lib/map/client', () => ({ fetchWormholeCatalog: vi.fn() }));
vi.mock('@/components/map/styling', () => ({ systemClassColor: () => '#ffffff' }));

// Stub Base UI Select primitives — they require a portal/popup context jsdom can't provide.
// Each SelectItem renders a div with data-slot="select-item" and data-value=<the value>.
vi.mock('@/components/ui/select', async () => {
  const { createElement } = await import('react');
  const Select = ({ children }: { children?: React.ReactNode }) =>
    createElement('div', { 'data-slot': 'select' }, children);
  const SelectTrigger = ({ children }: { children?: React.ReactNode }) =>
    createElement('div', { 'data-slot': 'select-trigger' }, children);
  const SelectValue = ({ children }: { children?: React.ReactNode }) =>
    createElement('div', { 'data-slot': 'select-value' }, typeof children === 'function' ? null : children);
  const SelectContent = ({ children }: { children?: React.ReactNode }) =>
    createElement('div', { 'data-slot': 'select-content' }, children);
  const SelectItem = ({ children, value }: { children?: React.ReactNode; value?: string; className?: string }) =>
    createElement('div', { 'data-slot': 'select-item', 'data-value': value }, children);
  return { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
});

import { fetchWormholeCatalog } from '@/lib/map/client';
import { WormholeTypeSelect } from '@/components/sidebar/WormholeTypeSelect';
import type { WormholeCatalogEntry } from '@/types';

const mockFetch = vi.mocked(fetchWormholeCatalog);

// The host system is a C3 whose only static is A242 (typeId 1). The component
// derives `isStatic` / `matchesClass` from these props via `annotateWormholeTypes`,
// so the fixtures are bare catalog rows and the grouping is computed end-to-end.
const SYSTEM_SECURITY = 'C3';
const SYSTEM_STATIC_TYPE_IDS = [1];

function makeEntry(
  typeId: number,
  name: string,
  overrides: Partial<WormholeCatalogEntry> = {},
): WormholeCatalogEntry {
  return {
    typeId,
    name,
    sourceClasses: ['C5'], // does not include 'C3' → not class-matched unless overridden
    targetClass: null,
    jumpMassClass: null,
    ...overrides,
  };
}

// A242 is the system's static (typeId 1) → isStatic, hence pinned + matchesClass.
const STATIC_A242 = makeEntry(1, 'A242', { sourceClasses: ['C3'], targetClass: 'C3' });
// K162 has a null source → matches anywhere; the component pins it after statics.
const K162 = makeEntry(2, 'K162', { sourceClasses: null });
const CLASS_MATCHED_C140 = makeEntry(3, 'C140', { sourceClasses: ['C3'] });
const CLASS_MATCHED_N110 = makeEntry(4, 'N110', { sourceClasses: ['C3'] });
const OTHER_X702 = makeEntry(5, 'X702', { sourceClasses: ['C5'] });

function renderSelect(container: HTMLDivElement, root: Root) {
  act(() => {
    root.render(
      <WormholeTypeSelect
        systemSecurity={SYSTEM_SECURITY}
        staticTypeIds={SYSTEM_STATIC_TYPE_IDS}
        value={null}
        onValueChange={vi.fn()}
      />,
    );
  });
}

describe('WormholeTypeSelect — K162 grouping', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function resolvedOptions(options: WormholeCatalogEntry[]) {
    mockFetch.mockResolvedValue({ ok: true, data: options });
  }

  function itemValues(): string[] {
    return Array.from(
      container.querySelectorAll<HTMLElement>('[data-slot="select-item"]'),
    )
      .map((el) => el.dataset.value ?? '')
      .filter(Boolean);
  }

  it('renders K162 before other class-matched options', async () => {
    resolvedOptions([STATIC_A242, CLASS_MATCHED_C140, K162, CLASS_MATCHED_N110]);
    renderSelect(container, root);
    await act(async () => {});

    const values = itemValues();
    const k162Idx = values.indexOf('2');
    const c140Idx = values.indexOf('3');
    const n110Idx = values.indexOf('4');

    expect(k162Idx).toBeGreaterThanOrEqual(0);
    expect(k162Idx).toBeLessThan(c140Idx);
    expect(k162Idx).toBeLessThan(n110Idx);
  });

  it('renders K162 after the statics', async () => {
    resolvedOptions([STATIC_A242, K162, CLASS_MATCHED_C140]);
    renderSelect(container, root);
    await act(async () => {});

    const values = itemValues();
    const staticIdx = values.indexOf('1'); // A242
    const k162Idx = values.indexOf('2');

    expect(k162Idx).toBeGreaterThan(staticIdx);
  });

  it('does not include K162 in the class-matched group', async () => {
    resolvedOptions([CLASS_MATCHED_C140, K162, CLASS_MATCHED_N110]);
    renderSelect(container, root);
    await act(async () => {});

    const values = itemValues();
    const k162Idx = values.indexOf('2');
    const c140Idx = values.indexOf('3');
    const n110Idx = values.indexOf('4');

    // K162 comes before both class-matched entries
    expect(k162Idx).toBeLessThan(c140Idx);
    expect(k162Idx).toBeLessThan(n110Idx);
  });

  it('renders without K162 when it is absent from the catalog', async () => {
    resolvedOptions([STATIC_A242, CLASS_MATCHED_C140]);
    renderSelect(container, root);
    await act(async () => {});

    const values = itemValues();
    expect(values).not.toContain('2');
    expect(values).toContain('1'); // A242 static
    expect(values).toContain('3'); // C140 class-matched
  });

  it('renders K162 even when there are no statics', async () => {
    resolvedOptions([CLASS_MATCHED_C140, K162]);
    renderSelect(container, root);
    await act(async () => {});

    const values = itemValues();
    expect(values).toContain('2');
    expect(values.indexOf('2')).toBeLessThan(values.indexOf('3'));
  });

  it('excludes K162 from the others (show-all) group', async () => {
    // K162 has matchesClass:true so it wouldn't normally be in others, but
    // confirm it ends up in exitHole and not pushed to others when it could
    // theoretically slip through — i.e. it's never behind the "show all" toggle.
    resolvedOptions([K162, OTHER_X702]);
    renderSelect(container, root);
    await act(async () => {});

    const content = container.querySelector('[data-slot="select-content"]')!;
    const k162El = content.querySelector('[data-value="2"]');
    expect(k162El).not.toBeNull();

    // X702 is in "others" and hidden by default — its SelectItem should not be in the DOM.
    expect(content.querySelector('[data-value="5"]')).toBeNull();
  });
});
