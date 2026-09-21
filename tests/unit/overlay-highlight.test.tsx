import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { Highlight } from '@/components/map/SystemOverlay';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(text: string, needle?: string) {
  act(() => root.render(<Highlight text={text} needle={needle} />));
  return {
    text: container.textContent ?? '',
    marks: [...container.querySelectorAll('mark')].map((m) => m.textContent ?? ''),
  };
}

describe('Highlight', () => {
  it('renders the text untouched with no needle', () => {
    expect(render("Bob's Prospect")).toEqual({ text: "Bob's Prospect", marks: [] });
  });

  it('marks every occurrence, case-insensitively', () => {
    const out = render('Prospect prospect PROS', 'pros');
    expect(out.text).toBe('Prospect prospect PROS');
    expect(out.marks).toEqual(['Pros', 'pros', 'PROS']);
  });

  it('marks in the original casing, not the lowercased copy', () => {
    expect(render('ARMPIT', 'armpit').marks).toEqual(['ARMPIT']);
  });

  it('leaves the text unmarked when there is no hit', () => {
    expect(render('Prospect', 'loki')).toEqual({ text: 'Prospect', marks: [] });
  });

  it('renders text whose lowercasing changes length intact and unmarked', () => {
    // 'İ' lowercases to two code units, so offsets taken in the lowercased copy
    // no longer address the original; the text has to survive whole regardless.
    const out = render('İstanbul Loki', 'loki');
    expect(out.text).toBe('İstanbul Loki');
    expect(out.marks).toEqual([]);
  });

  it('still marks a needle whose own lowercasing changes length', () => {
    const out = render('i̇stanbul', 'İ');
    expect(out.text).toBe('i̇stanbul');
    expect(out.marks).toEqual(['i̇']);
  });
});
