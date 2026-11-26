/** Experimental per-panel undo stacks (client-only; last 50 per panel). */

import { runSignatureUndoPayload, type SignatureUndoPayload, type SignatureUndoRuntime } from '@/lib/experimentalSignatureUndo';

export const EXPERIMENTAL_UNDO_MAX = 50;

export type ExperimentalUndoPanel = 'map' | 'signatures' | 'routes' | 'inspector';

export type ExperimentalUndoCommand = {
  label: string;
  undo: () => Promise<void> | void;
  redo?: () => Promise<void> | void;
  /** Optional serializable inverse for localStorage replay after reload. */
  serialized?: {
    undo: unknown;
    redo?: unknown;
  };
};

type StackEntry = ExperimentalUndoCommand & { seq: number };

const stacks = new Map<ExperimentalUndoPanel, { past: StackEntry[]; future: StackEntry[] }>();

type PanelExecutor = (payload: unknown, direction: 'undo' | 'redo') => void | Promise<void>;

const executors = new Map<ExperimentalUndoPanel, PanelExecutor>();

function getStack(panel: ExperimentalUndoPanel) {
  let s = stacks.get(panel);
  if (!s) {
    s = { past: [], future: [] };
    stacks.set(panel, s);
  }
  return s;
}

export function experimentalUndoClear(panel: ExperimentalUndoPanel): void {
  stacks.set(panel, { past: [], future: [] });
  persistStacks();
}

export function experimentalUndoResetAll(): void {
  stacks.clear();
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}

const STORAGE_KEY = 'aperture:experimental:undo:v2';

type StoredEntry = { label: string; seq: number; undo: unknown; redo?: unknown };
type StoredStacks = Partial<Record<ExperimentalUndoPanel, { past: StoredEntry[]; future: StoredEntry[] }>>;

function entryToStored(entry: StackEntry): StoredEntry | null {
  if (!entry.serialized) return null;
  return {
    label: entry.label,
    seq: entry.seq,
    undo: entry.serialized.undo,
    redo: entry.serialized.redo,
  };
}

function rebuildCommand(panel: ExperimentalUndoPanel, stored: StoredEntry): StackEntry | null {
  const executor = executors.get(panel);
  if (!executor) return null;
  return {
    label: stored.label,
    seq: stored.seq,
    serialized: { undo: stored.undo, redo: stored.redo },
    undo: () => executor(stored.undo, 'undo'),
    redo: stored.redo ? () => executor(stored.redo, 'redo') : undefined,
  };
}

function persistStacks(): void {
  if (typeof localStorage === 'undefined') return;
  const data: StoredStacks = {};
  for (const [panel, stack] of stacks.entries()) {
    const past = stack.past.map(entryToStored).filter((e): e is StoredEntry => e != null);
    const future = stack.future.map(entryToStored).filter((e): e is StoredEntry => e != null);
    if (past.length === 0 && future.length === 0) continue;
    data[panel] = { past: past.slice(-EXPERIMENTAL_UNDO_MAX), future: future.slice(-EXPERIMENTAL_UNDO_MAX) };
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* quota */
  }
}

function hydratePanelFromStorage(panel: ExperimentalUndoPanel, blob: StoredStacks[typeof panel]) {
  if (!blob) return;
  const rebuiltPast: StackEntry[] = [];
  const rebuiltFuture: StackEntry[] = [];
  for (const stored of blob.past ?? []) {
    const cmd = rebuildCommand(panel, stored);
    if (cmd) rebuiltPast.push(cmd);
  }
  for (const stored of blob.future ?? []) {
    const cmd = rebuildCommand(panel, stored);
    if (cmd) rebuiltFuture.push(cmd);
  }
  if (rebuiltPast.length > 0 || rebuiltFuture.length > 0) {
    stacks.set(panel, { past: rebuiltPast, future: rebuiltFuture });
  }
}

export function experimentalUndoHydrateFromStorage(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as StoredStacks;
    for (const panel of Object.keys(parsed) as ExperimentalUndoPanel[]) {
      hydratePanelFromStorage(panel, parsed[panel]);
    }
  } catch {
    /* ignore */
  }
}

export function experimentalUndoSetExecutor(panel: ExperimentalUndoPanel, executor: PanelExecutor | null): void {
  if (executor) executors.set(panel, executor);
  else executors.delete(panel);
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredStacks;
      hydratePanelFromStorage(panel, parsed[panel]);
    } catch {
      /* ignore */
    }
  }
}

export function experimentalUndoPush(panel: ExperimentalUndoPanel, cmd: ExperimentalUndoCommand): void {
  const s = getStack(panel);
  s.future = [];
  s.past.push({ ...cmd, seq: Date.now() });
  while (s.past.length > EXPERIMENTAL_UNDO_MAX) s.past.shift();
  persistStacks();
}

export function experimentalUndoCan(panel: ExperimentalUndoPanel): { undo: boolean; redo: boolean } {
  const s = getStack(panel);
  return { undo: s.past.length > 0, redo: s.future.length > 0 };
}

export async function experimentalUndoApply(panel: ExperimentalUndoPanel): Promise<boolean> {
  const s = getStack(panel);
  const entry = s.past.pop();
  if (!entry) return false;
  await entry.undo();
  if (entry.redo) s.future.push(entry);
  persistStacks();
  return true;
}

export async function experimentalRedoApply(panel: ExperimentalUndoPanel): Promise<boolean> {
  const s = getStack(panel);
  const entry = s.future.pop();
  if (!entry?.redo) return false;
  await entry.redo();
  s.past.push(entry);
  while (s.past.length > EXPERIMENTAL_UNDO_MAX) s.past.shift();
  persistStacks();
  return true;
}

/** Which panel owns focus for Ctrl+Z — nearest `[data-panel-id]` ancestor. */
export function experimentalUndoPanelFromFocus(): ExperimentalUndoPanel | null {
  if (typeof document === 'undefined') return null;
  const el = document.activeElement?.closest?.('[data-panel-id]') as HTMLElement | null;
  const id = el?.getAttribute('data-panel-id');
  if (id === 'canvas') return 'map';
  if (id === 'signatures') return 'signatures';
  if (id === 'route') return 'routes';
  if (id === 'inspector' || id === 'intel') return 'inspector';
  return null;
}

export function experimentalUndoPushSignature(
  label: string,
  undoPayload: SignatureUndoPayload,
  redoPayload: SignatureUndoPayload | undefined,
  runtime: SignatureUndoRuntime,
): void {
  experimentalUndoPush('signatures', {
    label,
    undo: () => runSignatureUndoPayload(runtime, undoPayload, 'undo'),
    redo: redoPayload ? () => runSignatureUndoPayload(runtime, redoPayload, 'redo') : undefined,
    serialized: { undo: undoPayload, redo: redoPayload },
  });
}
