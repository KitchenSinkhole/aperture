'use client';

import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { subscribeExperimentalPanelAdd } from '@/lib/experimentalPanelActionBus';
import { parseDscanPaste } from '@/lib/map/dscanParser';
import { Button } from '@/components/ui/button';

export function ExperimentalDscanPanel() {
  const [text, setText] = useState('');
  const [prev, setPrev] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(
    () =>
      subscribeExperimentalPanelAdd('dscan', () => {
        textareaRef.current?.focus();
      }),
    [],
  );

  const rows = useMemo(() => (text.trim() ? parseDscanPaste(text) : []), [text]);
  const diff = useMemo(() => {
    if (!prev.trim() || !text.trim()) return { added: new Set<string>(), removed: new Set<string>() };
    const p = new Set(parseDscanPaste(prev).map((r) => r.name));
    const cur = new Set(rows.map((r) => r.name));
    const added = new Set(rows.filter((r) => !p.has(r.name)).map((r) => r.name));
    const removed = new Set([...p].filter((n) => !cur.has(n)));
    return { added, removed };
  }, [prev, text, rows]);

  const summary = useMemo(() => {
    const byType = new Map<string, number>();
    for (const r of rows) {
      byType.set(r.typeName, (byType.get(r.typeName) ?? 0) + 1);
    }
    return [...byType.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  return (
    <div className="flex flex-col gap-2 p-2 text-xs">
      <textarea
        ref={textareaRef}
        rows={6}
        placeholder="Paste D-Scan…"
        value={text}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
        className="min-h-[6rem] w-full rounded-md border border-input bg-background px-2 py-1 font-mono text-xs"
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={() => setPrev(text)}>
          Save snapshot
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setText('')}>
          Clear
        </Button>
      </div>
      {rows.length > 0 ? (
        <p className="text-muted-foreground">
          {rows.length} contacts · {summary.length} types
          {diff.added.size > 0 ? ` · +${diff.added.size} new` : ''}
          {diff.removed.size > 0 ? ` · −${diff.removed.size} gone` : ''}
        </p>
      ) : null}
      {summary.length > 0 ? (
        <ul className="flex flex-wrap gap-1 text-[10px] text-muted-foreground">
          {summary.slice(0, 8).map(([type, n]) => (
            <li key={type} className="rounded bg-muted px-1.5 py-0.5">
              {type} ({n})
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="max-h-48 overflow-auto divide-y">
        {rows.map((r) => (
          <li
            key={`${r.name}-${r.typeName}`}
            className={
              diff.added.has(r.name)
                ? 'bg-emerald-500/10 px-1 py-0.5'
                : 'px-1 py-0.5'
            }
          >
            {r.name}{' '}
            <span className="text-muted-foreground">{r.typeName}</span>
          </li>
        ))}
        {[...diff.removed].map((name) => (
          <li key={`removed-${name}`} className="bg-red-500/10 px-1 py-0.5 line-through opacity-70">
            {name} <span className="text-muted-foreground">(removed)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}