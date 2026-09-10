'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { fetchWormholeCatalog, type UpdateConnectionBody } from '@/lib/map/client';
import type { WhJumpMass } from '@/lib/map/enumLabels';
import { BUFFER_TTL_MS, resolveTransit } from '@/lib/map/transitResolve';
import type { MapConnectionEdge, MapSignature, MapSystemNode } from '@/types';
import { useTraversals } from './MapPresenceContext';

/**
 * Pure candidate filter: the source system's wormhole signatures that could be
 * the hole the pilot just transited. A sig qualifies when its WH type can lead
 * to the destination's class (`targetClass === destClass`), when its type
 * leads anywhere (`targetClass == null`, e.g. K162), or when it has no type set
 * yet (`typeId == null`). Sigs already bound to any connection are dropped —
 * each sig is one wormhole, so an assigned one can't be the hole just jumped.
 * Exported for unit testing.
 */
export function transitCandidates(args: {
  signatures: MapSignature[];
  sourceMapSystemId: string;
  destClass: string | null;
  /** `universe_wormhole.type_id` → destination class label; absent ⇒ unknown ⇒ treated as "leads anywhere". */
  targetClassByTypeId: Map<number, string | null>;
}): MapSignature[] {
  const { signatures, sourceMapSystemId, destClass, targetClassByTypeId } = args;
  return signatures.filter((s) => {
    if (s.groupKey !== 'wormhole') return false;
    if (s.mapSystemId !== sourceMapSystemId) return false;
    if (s.mapConnectionId != null) return false; // already assigned to a hole
    if (s.typeId == null) return true;
    const targetClass = targetClassByTypeId.get(s.typeId) ?? null;
    return targetClass == null || targetClass === destClass;
  });
}

type Prompt = {
  /** `from→to` EVE-system key; dedupes a fleet jumping the same hole together. */
  key: string;
  characterName: string;
  sourceMapSystemId: string;
  destLabel: string;
  destClass: string | null;
  connectionId: string;
};

/** A viewer jump waiting for its folded systems/connection to reach client state. */
type PendingJump = {
  key: string;
  characterId: number;
  characterName: string;
  fromSystemId: number;
  toSystemId: number;
  /** ms epoch the jump was observed; the entry is forgotten after `BUFFER_TTL_MS`. */
  at: number;
};

type ResolveResult =
  | { kind: 'open'; prompt: Prompt }
  | { kind: 'drop' }
  | { kind: 'pending' };

/**
 * Match one viewer jump against current map state. `drop` = a gate link or an
 * already-mapped hole (never prompt); `open` = a folded, unmapped `wh` hole to
 * ask about; `pending` = the fold (systems/connection) hasn't reached client
 * state yet, so the caller should buffer and retry. Reads only its arguments.
 */
function resolveJump(
  jump: { characterName: string; fromSystemId: number; toSystemId: number },
  systems: MapSystemNode[],
  connections: MapConnectionEdge[],
  signatures: MapSignature[],
): ResolveResult {
  const transit = resolveTransit(jump, systems, connections);
  if (transit.kind !== 'resolved') return transit;
  const { here: dest, cameFrom: source, connection: wh } = transit;
  // Hole is already mapped (a sig points at this connection) — nothing to ask.
  if (signatures.some((s) => s.mapConnectionId === wh.id)) return { kind: 'drop' };
  return {
    kind: 'open',
    prompt: {
      key: `${jump.fromSystemId}->${jump.toSystemId}`,
      characterName: jump.characterName,
      sourceMapSystemId: source.id,
      destLabel: dest.alias ?? dest.name,
      destClass: dest.security,
      connectionId: wh.id,
    },
  };
}

/** First buffered jump that currently resolves to an openable prompt, else null. */
function pickActivePrompt(
  pending: PendingJump[],
  systems: MapSystemNode[],
  connections: MapConnectionEdge[],
  signatures: MapSignature[],
): Prompt | null {
  for (const p of pending) {
    const resolved = resolveJump(p, systems, connections, signatures);
    if (resolved.kind === 'open') return resolved.prompt;
  }
  return null;
}

/**
 * "Which signature did you come through?" overlay. Watches the viewer's own
 * pilots via `useTraversals`; when one jumps between two systems that aren't
 * gate-connected, it offers the source system's matching wormhole sigs and, on
 * click, populates that sig's "Leads to" (the folded connection). Mirrors the
 * behaviour of Galaxy Finder / Tripwire / Wanderer.
 *
 * Must be rendered inside `MapPresenceProvider`. Renders nothing until a
 * qualifying jump produces at least one candidate signature (so filaments and
 * unscanned sources stay silent).
 */
export function TransitSignaturePrompt({
  systems,
  connections,
  signatures,
  viewerCharacters,
  onPatchSignature,
  onConnectionPatch,
}: {
  systems: MapSystemNode[];
  connections: MapConnectionEdge[];
  signatures: MapSignature[];
  viewerCharacters: { id: number; name: string }[];
  onPatchSignature: (signatureId: string, patch: { mapConnectionId: string }) => void;
  onConnectionPatch: (connectionId: string, patch: UpdateConnectionBody) => void;
}) {
  const [targetClassByTypeId, setTargetClassByTypeId] = useState<Map<number, string | null>>(
    () => new Map(),
  );
  // Parallel `type_id → inferred jump-mass band` map (server-derived from
  // `wormholeMaxJumpMass`), used to auto-set the connection's size when the
  // picked sig already carries a type.
  const [jumpMassByTypeId, setJumpMassByTypeId] = useState<Map<number, WhJumpMass | null>>(
    () => new Map(),
  );
  // Viewer jumps whose fold hasn't reached client state yet (the `characterUpdate`
  // breadcrumb can beat the `connection.create` it was broadcast after). The
  // displayed prompt is derived from this buffer each render; the TTL timer below
  // prunes any jump whose fold never arrives.
  const [pending, setPending] = useState<PendingJump[]>([]);

  // The traversal callback reads the latest props through this ref so a
  // re-render (new systems/connections) doesn't re-subscribe the listener; the
  // prune timer reads them the same way.
  const latest = useRef({ systems, connections, signatures, viewerCharacters });
  useEffect(() => {
    latest.current = { systems, connections, signatures, viewerCharacters };
  });

  useTraversals((t) => {
    const { systems, connections, signatures, viewerCharacters } = latest.current;
    const character = viewerCharacters.find((c) => c.id === t.characterId);
    if (!character) return; // only the viewer's own pilots fire the prompt

    const key = `${t.fromSystemId}->${t.toSystemId}`;
    const resolved = resolveJump(
      { characterName: character.name, fromSystemId: t.fromSystemId, toSystemId: t.toSystemId },
      systems,
      connections,
      signatures,
    );

    // A fresh jump by this pilot supersedes any earlier buffered jump of theirs
    // (they can only be in one place); also dedupes the from→to key. Buffer
    // unless it's a gate/already-mapped jump (`drop`); the render derivation
    // shows it once resolvable, whether that's now or a beat later.
    setPending((prev) => {
      const others = prev.filter((p) => p.characterId !== t.characterId && p.key !== key);
      if (resolved.kind === 'drop') return others;
      return [
        ...others,
        {
          key,
          characterId: t.characterId,
          characterName: character.name,
          fromSystemId: t.fromSystemId,
          toSystemId: t.toSystemId,
          at: Date.now(),
        },
      ];
    });
  });

  // Displayed prompt, derived from the buffer against live props (not the ref) so
  // it reflects a `connection.create` that folded in after the traversal fired.
  // One shows at a time; a second resolvable jump waits for it to clear.
  const active = pickActivePrompt(pending, systems, connections, signatures);
  const activeKey = active?.key ?? null;

  // Load the WH-type → target-class / jump-mass maps for filtering. These are
  // system-independent catalog facts, so this hits the shared session-wide WH
  // catalog (same lookup `WormholeTypeSelect` / the sig panel use) — usually warm.
  useEffect(() => {
    if (!activeKey) return;
    let cancelled = false;
    fetchWormholeCatalog().then((result) => {
      if (cancelled || !result.ok) return;
      setTargetClassByTypeId(new Map(result.data.map((o) => [o.typeId, o.targetClass])));
      setJumpMassByTypeId(new Map(result.data.map((o) => [o.typeId, o.jumpMassClass])));
    });
    return () => {
      cancelled = true;
    };
  }, [activeKey]);

  // Prune jumps whose fold never arrived. A jump that has become resolvable
  // (shown, `open`) is kept regardless of age — the TTL only bounds *waiting*;
  // once shown, the prompt persists until acted on. The timer fires at the
  // soonest pending expiry and re-arms as the buffer changes.
  useEffect(() => {
    if (pending.length === 0) return;
    const soonest = Math.min(...pending.map((p) => p.at)) + BUFFER_TTL_MS;
    const timer = setTimeout(
      () => {
        setPending((prev) => {
          const { systems, connections, signatures } = latest.current;
          const next = prev.filter(
            (p) =>
              resolveJump(p, systems, connections, signatures).kind === 'open' ||
              Date.now() - p.at < BUFFER_TTL_MS,
          );
          // Return the same reference when nothing expired so React bails out —
          // a new array would re-render, re-arm this timer at an already-elapsed
          // expiry, and busy-loop while a resolved prompt sits open.
          return next.length === prev.length ? prev : next;
        });
      },
      Math.max(0, soonest - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [pending]);

  const dismiss = useCallback((key: string) => {
    setPending((prev) => prev.filter((p) => p.key !== key));
  }, []);

  if (!active) return null;

  const candidates = transitCandidates({
    signatures,
    sourceMapSystemId: active.sourceMapSystemId,
    destClass: active.destClass,
    targetClassByTypeId,
  });
  if (candidates.length === 0) return null;

  return (
    <Card className="nodrag nopan absolute left-2 top-2 z-10 max-w-xs gap-2 p-3 text-sm shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">
          {active.characterName} jumped into {active.destLabel} — which signature?
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-mr-1 -mt-1 size-6 shrink-0"
          aria-label="Dismiss"
          onClick={() => dismiss(active.key)}
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        {candidates.map((sig) => (
          <Button
            key={sig.id}
            type="button"
            variant="outline"
            size="sm"
            className="justify-between gap-3"
            onClick={() => {
              onPatchSignature(sig.id, { mapConnectionId: active.connectionId });
              // Carry the sig type's inferred jump-mass band onto the connection
              // (e.g. B274 → M); skip when the type is unset or can't be inferred.
              const band = sig.typeId == null ? null : jumpMassByTypeId.get(sig.typeId) ?? null;
              if (band != null) onConnectionPatch(active.connectionId, { jumpMassClass: band });
              // Carry a pre-jump EOL stage onto the connection it resolved to.
              if (sig.eolStage !== 'none')
                onConnectionPatch(active.connectionId, { eolStage: sig.eolStage });
              dismiss(active.key);
            }}
          >
            <span className="font-mono">{sig.sigId}</span>
            <span className="text-muted-foreground text-xs">
              {sig.wormholeCode ?? 'no type'}
            </span>
          </Button>
        ))}
      </div>
    </Card>
  );
}
