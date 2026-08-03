'use client';

import { useMemo, useState } from 'react';
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

/** A whole way into the chain lit at once: the hops, and the systems they pass through. */
export type SpectatorHighlight = {
  /** `ap_map_system.id`s to ring. Endpoints of the highlighted connections ring too. */
  systemIds: string[];
  /** `ap_map_connection.id`s to lift, with their sig codes forced visible. */
  connectionIds: string[];
};

// xyflow requires stable type maps; module scope guarantees it.
const nodeTypes = { system: PublicSystemNode };
const edgeTypes = { connection: PublicConnectionEdge };

// Zoom, not larger type, is what makes the chain legible on a stream: enlarging
// node text would widen the tiles and break the positions the map's authors
// arranged them in.
const FIT_VIEW_OPTIONS = { padding: 0.15, maxZoom: 1.4 };

// xyflow's 0.5 floor is above the zoom a long chain needs to fit a phone, and
// `fitView` clamps to it — the reader lands mid-chain with the zoom-out and
// fit buttons both already at their limit, and no way to see the rest.
const MIN_ZOOM = 0.1;

export function SpectatorMap({
  data,
  highlight,
  onPaneClick,
}: {
  data: PublicMapViewData;
  /** The route currently lit, from a hovered or pinned entrances-board row. */
  highlight: SpectatorHighlight;
  /** Fires on a click anywhere off the chain, so a pinned route can be dismissed. */
  onPaneClick: () => void;
}) {
  const presenceBySystem = useMemo(() => presenceIndex(data.presence), [data.presence]);
  const [hoveredConnectionId, setHoveredConnectionId] = useState<string | null>(null);

  const securityBySystem = useMemo(
    () => new Map(data.systems.map((s) => [s.id, s.security])),
    [data.systems],
  );

  // Edge hover and board highlight merge into one set rather than running as
  // parallel channels, so a hovered hole and a lit route read identically.
  const litConnections = useMemo(() => {
    const ids = new Set(highlight.connectionIds);
    if (hoveredConnectionId) ids.add(hoveredConnectionId);
    return ids;
  }, [highlight.connectionIds, hoveredConnectionId]);

  const litSystems = useMemo(() => {
    const ids = new Set(highlight.systemIds);
    for (const c of data.connections) {
      if (litConnections.has(c.id)) {
        ids.add(c.source);
        ids.add(c.target);
      }
    }
    return ids;
  }, [data.connections, highlight.systemIds, litConnections]);

  const nodes = useMemo<Node<PublicSystemNodeData>[]>(
    () =>
      data.systems.map((s) => ({
        id: s.id,
        type: 'system',
        position: { x: s.positionX, y: s.positionY },
        data: {
          ...s,
          presence: presenceBySystem.get(s.systemId) ?? null,
          highlighted: litSystems.has(s.id),
        },
      })),
    [data.systems, presenceBySystem, litSystems],
  );

  const edges = useMemo<Edge<PublicConnectionEdgeData>[]>(
    () =>
      data.connections.map((c) => ({
        id: c.id,
        type: 'connection',
        source: c.source,
        target: c.target,
        data: {
          ...c,
          endpointSecurity: {
            source: securityBySystem.get(c.source) ?? null,
            target: securityBySystem.get(c.target) ?? null,
          },
          highlighted: litConnections.has(c.id),
          onHoverChange: setHoveredConnectionId,
        },
      })),
    [data.connections, securityBySystem, litConnections],
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
          minZoom={MIN_ZOOM}
          onPaneClick={onPaneClick}
          colorMode="dark"
          proOptions={{ hideAttribution: true }}
          aria-label={`${data.map.name} chain, ${data.systems.length} systems`}
        >
          <Background />
          <Controls
            showInteractive={false}
            position="bottom-right"
            fitViewOptions={FIT_VIEW_OPTIONS}
          />
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
