'use client';

import { useMemo } from 'react';
import {
  Background,
  ConnectionMode,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from '@xyflow/react';
import { Tooltip } from '@base-ui/react/tooltip';
import '@xyflow/react/dist/style.css';
import { PublicSystemNode, type PublicSystemNodeData } from './PublicSystemNode';
import { PublicConnectionEdge, type PublicConnectionEdgeData } from './PublicConnectionEdge';
import type { PublicMapPresence, PublicMapViewData } from '@/types';

// The chain itself. Everything the app's canvas does to *change* a map is
// absent — no drag, no connect, no selection, no context menus, no realtime
// subscription, no per-account viewport memory. What is left is the same
// picture, driven straight off the redacted snapshot.

// xyflow requires stable type maps; module scope guarantees it.
const nodeTypes = { system: PublicSystemNode };
const edgeTypes = { connection: PublicConnectionEdge };

// Zoom, not larger type, is what makes the chain legible on a stream: enlarging
// node text would widen the tiles and break the positions the map's authors
// arranged them in.
const FIT_VIEW_OPTIONS = { padding: 0.15, maxZoom: 1.4 };

export function SpectatorMap({
  data,
  highlightedSystemId,
}: {
  data: PublicMapViewData;
  /** `ap_map_system.id` of the entrance row under the cursor, if any. */
  highlightedSystemId: string | null;
}) {
  const presenceBySystem = useMemo(() => presenceIndex(data.presence), [data.presence]);

  const nodes = useMemo<Node<PublicSystemNodeData>[]>(
    () =>
      data.systems.map((s) => ({
        id: s.id,
        type: 'system',
        position: { x: s.positionX, y: s.positionY },
        data: {
          ...s,
          presence: presenceBySystem.get(s.systemId) ?? null,
          highlighted: s.id === highlightedSystemId,
        },
      })),
    [data.systems, presenceBySystem, highlightedSystemId],
  );

  const edges = useMemo<Edge<PublicConnectionEdgeData>[]>(
    () =>
      data.connections.map((c) => ({
        id: c.id,
        type: 'connection',
        source: c.source,
        target: c.target,
        data: c,
      })),
    [data.connections],
  );

  return (
    <ReactFlowProvider>
      <Tooltip.Provider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          deleteKeyCode={null}
          // Nodes declare only source handles, so an edge's target end has to be
          // allowed to bind to one.
          connectionMode={ConnectionMode.Loose}
          fitView
          fitViewOptions={FIT_VIEW_OPTIONS}
          colorMode="dark"
          preventScrolling={false}
          proOptions={{ hideAttribution: true }}
          aria-label={`${data.map.name} chain, ${data.systems.length} systems`}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </Tooltip.Provider>
    </ReactFlowProvider>
  );
}

/** Per-system presence at whatever fidelity the token published, keyed by EVE system id. */
function presenceIndex(
  presence: PublicMapPresence,
): Map<number, NonNullable<PublicSystemNodeData['presence']>> {
  const index = new Map<number, NonNullable<PublicSystemNodeData['presence']>>();
  if (presence.mode === 'anonymous') {
    for (const s of presence.systems) {
      index.set(s.systemId, { mode: 'anonymous', count: s.count, byClass: s.byClass });
    }
  } else if (presence.mode === 'full') {
    for (const p of presence.pilots) {
      const entry = index.get(p.systemId);
      if (entry?.mode === 'full') entry.pilots.push(p);
      else index.set(p.systemId, { mode: 'full', pilots: [p] });
    }
  }
  return index;
}
