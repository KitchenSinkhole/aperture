'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { fetchWormholeCatalog, type UpdateConnectionBody } from '@/lib/map/client';
import type { WhJumpMass } from '@/lib/map/enumLabels';
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
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [targetClassByTypeId, setTargetClassByTypeId] = useState<Map<number, string | null>>(
    () => new Map(),
  );
  // Parallel `type_id → inferred jump-mass band` map (server-derived from
  // `wormholeMaxJumpMass`), used to auto-set the connection's size when the
  // picked sig already carries a type.
  const [jumpMassByTypeId, setJumpMassByTypeId] = useState<Map<number, WhJumpMass | null>>(
    () => new Map(),
  );

  // The traversal callback reads the latest props through this ref so a
  // re-render (new systems/connections) doesn't re-subscribe the listener.
  const latest = useRef({ systems, connections, signatures, viewerCharacters });
  useEffect(() => {
    latest.current = { systems, connections, signatures, viewerCharacters };
  });

  useTraversals((t) => {
    const { systems, connections, signatures, viewerCharacters } = latest.current;
    const character = viewerCharacters.find((c) => c.id === t.characterId);
    if (!character) return; // only the viewer's own pilots fire the prompt

    const source = systems.find((s) => s.systemId === t.fromSystemId);
    const dest = systems.find((s) => s.systemId === t.toSystemId);
    if (!source || !dest) return; // source must be on the map to list its sigs

    const incident = connections.filter(
      (c) =>
        (c.source === source.id && c.target === dest.id) ||
        (c.source === dest.id && c.target === source.id),
    );
    // A gate jump (or any gate link between the two) is never a wormhole transit.
    if (incident.some((c) => c.scope === 'stargate')) return;
    const wh = incident.find((c) => c.scope === 'wh');
    if (!wh) return; // the folded WH connection isn't here yet — skip this jump
    // Hole is already mapped (a sig points at this connection) — nothing to ask.
    if (signatures.some((s) => s.mapConnectionId === wh.id)) return;

    setPrompt({
      key: `${t.fromSystemId}->${t.toSystemId}`,
      characterName: character.name,
      sourceMapSystemId: source.id,
      destLabel: dest.alias ?? dest.name,
      destClass: dest.security,
      connectionId: wh.id,
    });
  });

  // Load the WH-type → target-class / jump-mass maps for filtering. These are
  // system-independent catalog facts, so this hits the shared session-wide WH
  // catalog (same lookup `WormholeTypeSelect` / the sig panel use) — usually warm.
  useEffect(() => {
    if (!prompt) return;
    let cancelled = false;
    fetchWormholeCatalog().then((result) => {
      if (cancelled || !result.ok) return;
      setTargetClassByTypeId(new Map(result.data.map((o) => [o.typeId, o.targetClass])));
      setJumpMassByTypeId(new Map(result.data.map((o) => [o.typeId, o.jumpMassClass])));
    });
    return () => {
      cancelled = true;
    };
  }, [prompt]);

  const dismiss = useCallback(() => setPrompt(null), []);

  if (!prompt) return null;

  const candidates = transitCandidates({
    signatures,
    sourceMapSystemId: prompt.sourceMapSystemId,
    destClass: prompt.destClass,
    targetClassByTypeId,
  });
  if (candidates.length === 0) return null;

  return (
    <Card className="nodrag nopan absolute left-2 top-2 z-10 max-w-xs gap-2 p-3 text-sm shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">
          {prompt.characterName} jumped into {prompt.destLabel} — which signature?
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-mr-1 -mt-1 size-6 shrink-0"
          aria-label="Dismiss"
          onClick={dismiss}
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
              onPatchSignature(sig.id, { mapConnectionId: prompt.connectionId });
              // Carry the sig type's inferred jump-mass band onto the connection
              // (e.g. B274 → M); skip when the type is unset or can't be inferred.
              const band = sig.typeId == null ? null : jumpMassByTypeId.get(sig.typeId) ?? null;
              if (band != null) onConnectionPatch(prompt.connectionId, { jumpMassClass: band });
              dismiss();
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
