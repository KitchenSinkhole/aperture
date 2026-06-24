import type { MapConnectionEdge, MapNote, MapSignature, MapSystemNode, MapViewData } from '@/types';
import type { MapEventPayload } from '@/lib/realtime/protocol';

/**
 * Pure reducer: apply one realtime map event to the current canvas view state.
 * Returns a new `MapViewData` (never mutates). Called on the client inside a
 * `useState` + `useEffect` pair in `MapCanvas.tsx`.
 *
 * `map.create`, `map.delete`, `map.restore`, and `map.purge` have no canvas
 * representation; `map.delete` navigation is handled by the separate
 * `mapDeleted` WS task. `map.restore`/`map.purge` are admin-only events and
 * never reach an open user canvas (soft-deleted maps are already filtered out
 * for non-admin viewers), so the reducer treats them as no-ops.
 */
export function applyEvent(state: MapViewData, payload: MapEventPayload): MapViewData {
  switch (payload.kind) {
    case 'system.added': {
      // Pure node-body delta: `payload` structurally satisfies MapSystemNode
      // (contains all required fields). Signatures are NOT carried on the event —
      // the canvas hydrates a (re)added system's surviving sigs via
      // `fetchSystemSignatures` on receipt (kept the `pg_notify` payload small).
      const nodeData = payload as unknown as MapSystemNode;
      const exists = state.systems.some((s) => s.id === nodeData.id);
      const systems = exists
        ? state.systems.map((s) => (s.id === nodeData.id ? nodeData : s))
        : [...state.systems, nodeData];
      return { ...state, systems };
    }

    case 'system.removed':
      // Removal hides the system (visible=false) and orphans its connections +
      // signatures. The server load filters connections to visible-both-endpoint
      // pairs, so mirror that here — otherwise consumers that iterate connections
      // directly (SystemOverlay) keep showing the orphans as "Unknown" until reload.
      return {
        ...state,
        systems: state.systems.filter((s) => s.id !== payload.id),
        connections: state.connections.filter(
          (c) => c.source !== payload.id && c.target !== payload.id,
        ),
        signatures: state.signatures.filter((s) => s.mapSystemId !== payload.id),
      };

    case 'system.updated': {
      return {
        ...state,
        systems: state.systems.map((s): MapSystemNode => {
          if (s.id !== payload.id) return s;
          const next = { ...s };
          if (payload.alias !== undefined) next.alias = payload.alias;
          if (payload.tag !== undefined) next.tag = payload.tag;
          if (payload.intelNotes !== undefined) next.intelNotes = payload.intelNotes;
          if (payload.status !== undefined) next.status = payload.status;
          if (payload.locked !== undefined) next.locked = payload.locked;
          if (payload.positionX !== undefined) next.positionX = payload.positionX;
          if (payload.positionY !== undefined) next.positionY = payload.positionY;
          if (payload.rallyAt !== undefined) next.rallyAt = payload.rallyAt;
          return next;
        }),
      };
    }

    case 'connection.create': {
      // payload structurally satisfies MapConnectionEdge.
      const edge = payload as MapConnectionEdge;
      const exists = state.connections.some((c) => c.id === edge.id);
      if (exists) {
        return {
          ...state,
          connections: state.connections.map((c) => (c.id === edge.id ? edge : c)),
        };
      }
      return { ...state, connections: [...state.connections, edge] };
    }

    case 'connection.update': {
      return {
        ...state,
        connections: state.connections.map((c): MapConnectionEdge => {
          if (c.id !== payload.id) return c;
          const next = { ...c };
          if (payload.scope !== undefined) next.scope = payload.scope;
          if (payload.massStatus !== undefined) next.massStatus = payload.massStatus;
          if (payload.jumpMassClass !== undefined) next.jumpMassClass = payload.jumpMassClass;
          if (payload.eolStage !== undefined) next.eolStage = payload.eolStage;
          if (payload.preserveMass !== undefined) next.preserveMass = payload.preserveMass;
          if (payload.isRolling !== undefined) next.isRolling = payload.isRolling;
          if (payload.isStatic !== undefined) next.isStatic = payload.isStatic;
          if (payload.eolAt !== undefined) next.eolAt = payload.eolAt;
          return next;
        }),
      };
    }

    case 'connection.delete':
      return {
        ...state,
        connections: state.connections.filter((c) => c.id !== payload.id),
        // ap_map_signature.map_connection_id is ON DELETE CASCADE — Postgres
        // drops these rows when the connection goes, but only a connection.delete
        // event is emitted. Mirror the cascade so the client never keeps a
        // signature whose DB row is gone (deleting it would 400 "Signature not
        // found.").
        signatures: state.signatures.filter((s) => s.mapConnectionId !== payload.id),
      };

    case 'map.update': {
      if (payload.name === undefined) return state;
      return { ...state, map: { ...state.map, name: payload.name } };
    }

    case 'signature.create': {
      const sigData = payload as MapSignature;
      const exists = state.signatures.some((s) => s.id === sigData.id);
      if (exists) {
        return {
          ...state,
          signatures: state.signatures.map((s) => (s.id === sigData.id ? sigData : s)),
        };
      }
      return { ...state, signatures: [...state.signatures, sigData] };
    }

    case 'signature.update': {
      // Self-heal: when the full post-update snapshot rides the event, upsert it
      // (replace-by-id, else append) so a client missing this sig's baseline
      // materializes it instead of silently no-op'ing the merge-by-id below.
      if (payload.snapshot) {
        const snap = payload.snapshot as MapSignature;
        const exists = state.signatures.some((s) => s.id === snap.id);
        return {
          ...state,
          signatures: exists
            ? state.signatures.map((s) => (s.id === snap.id ? snap : s))
            : [...state.signatures, snap],
        };
      }
      return {
        ...state,
        signatures: state.signatures.map((s): MapSignature => {
          if (s.id !== payload.id) return s;
          const next = { ...s };
          if (payload.mapConnectionId !== undefined) next.mapConnectionId = payload.mapConnectionId;
          if (payload.sigId !== undefined) next.sigId = payload.sigId;
          if (payload.groupKey !== undefined) next.groupKey = payload.groupKey;
          if (payload.typeId !== undefined) next.typeId = payload.typeId;
          if (payload.wormholeCode !== undefined) next.wormholeCode = payload.wormholeCode;
          if (payload.name !== undefined) next.name = payload.name;
          if (payload.description !== undefined) next.description = payload.description;
          if (payload.expiresAt !== undefined) next.expiresAt = payload.expiresAt;
          if (payload.updatedAt !== undefined) next.updatedAt = payload.updatedAt;
          return next;
        }),
      };
    }

    case 'signature.delete':
      return { ...state, signatures: state.signatures.filter((s) => s.id !== payload.id) };

    case 'note.created': {
      // payload structurally satisfies MapNote (full body).
      const note = payload as unknown as MapNote;
      const exists = state.notes.some((n) => n.id === note.id);
      if (exists) {
        return { ...state, notes: state.notes.map((n) => (n.id === note.id ? note : n)) };
      }
      return { ...state, notes: [...state.notes, note] };
    }

    case 'note.updated': {
      return {
        ...state,
        notes: state.notes.map((n): MapNote => {
          if (n.id !== payload.id) return n;
          const next = { ...n };
          // `title` always rides; the rest only when changed.
          next.title = payload.title;
          if (payload.content !== undefined) next.content = payload.content;
          if (payload.severity !== undefined) next.severity = payload.severity;
          if (payload.locked !== undefined) next.locked = payload.locked;
          if (payload.positionX !== undefined) next.positionX = payload.positionX;
          if (payload.positionY !== undefined) next.positionY = payload.positionY;
          next.lastEditedByCharacterId = payload.lastEditedByCharacterId;
          next.lastEditedByName = payload.lastEditedByName;
          next.updatedAt = payload.updatedAt;
          return next;
        }),
      };
    }

    case 'note.deleted':
      return { ...state, notes: state.notes.filter((n) => n.id !== payload.id) };

    case 'map.create':
    case 'map.delete':
    case 'map.restore':
    case 'map.purge':
      return state;

    default:
      return state;
  }
}
