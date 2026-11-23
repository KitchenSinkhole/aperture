import type { MapSignature } from '@/types';
import type { CreateSignatureBody, UpdateSignatureBody } from '@/lib/map/client';

export const SIGNATURE_DRAG_MIME = 'application/x-aperture-signature-id';

export type SignatureUndoPayload =
  | { kind: 'create'; forward: CreateSignatureBody; createdId: string }
  | { kind: 'delete'; snapshot: MapSignature }
  | { kind: 'patch'; signatureId: string; before: UpdateSignatureBody; after: UpdateSignatureBody }
  | { kind: 'bulkDelete'; snapshots: MapSignature[] }
  | { kind: 'bulkPaste'; beforeSnapshots: MapSignature[]; forwardPayloads: unknown[] };

export type SignatureUndoRuntime = {
  mapId: string;
  getSignatures: () => MapSignature[];
  deleteSignature: (id: string) => void;
  createSignature: (body: CreateSignatureBody) => void;
  patchSignature: (id: string, patch: UpdateSignatureBody) => void;
  bulkPaste: (payloads: unknown[]) => void;
};

function patchBodyFromSnapshot(sig: MapSignature): UpdateSignatureBody {
  return {
    mapConnectionId: sig.mapConnectionId,
    sigId: sig.sigId,
    groupKey: sig.groupKey,
    activityOverride: sig.activityOverride,
    typeId: sig.typeId,
    eolStage: sig.eolStage,
    name: sig.name,
    description: sig.description,
    expiresAt: sig.expiresAt,
  };
}

export function runSignatureUndoPayload(
  runtime: SignatureUndoRuntime,
  payload: SignatureUndoPayload,
  direction: 'undo' | 'redo',
): void {
  switch (payload.kind) {
    case 'create': {
      if (direction === 'undo') runtime.deleteSignature(payload.createdId);
      else runtime.createSignature(payload.forward);
      break;
    }
    case 'delete': {
      if (direction === 'undo') {
        runtime.createSignature({
          mapSystemId: payload.snapshot.mapSystemId,
          sigId: payload.snapshot.sigId,
          groupKey: payload.snapshot.groupKey,
          activityOverride: payload.snapshot.activityOverride,
          typeId: payload.snapshot.typeId,
          eolStage: payload.snapshot.eolStage,
          name: payload.snapshot.name,
          description: payload.snapshot.description,
          mapConnectionId: payload.snapshot.mapConnectionId,
          expiresAt: payload.snapshot.expiresAt,
        });
      } else runtime.deleteSignature(payload.snapshot.id);
      break;
    }
    case 'patch': {
      const patch = direction === 'undo' ? payload.before : payload.after;
      runtime.patchSignature(payload.signatureId, patch);
      break;
    }
    case 'bulkDelete': {
      if (direction === 'undo') {
        for (const s of payload.snapshots) {
          runtime.createSignature({
            mapSystemId: s.mapSystemId,
            sigId: s.sigId,
            groupKey: s.groupKey,
            activityOverride: s.activityOverride,
            typeId: s.typeId,
            eolStage: s.eolStage,
            name: s.name,
            description: s.description,
            mapConnectionId: s.mapConnectionId,
            expiresAt: s.expiresAt,
          });
        }
      } else {
        for (const s of payload.snapshots) runtime.deleteSignature(s.id);
      }
      break;
    }
    case 'bulkPaste': {
      if (direction === 'undo') {
        const beforeIds = new Set(payload.beforeSnapshots.map((s) => s.id));
        const touchedSystems = new Set(payload.beforeSnapshots.map((s) => s.mapSystemId));
        for (const sig of runtime.getSignatures()) {
          if (touchedSystems.has(sig.mapSystemId) && !beforeIds.has(sig.id)) {
            runtime.deleteSignature(sig.id);
          }
        }
        for (const s of payload.beforeSnapshots) {
          const cur = runtime.getSignatures().find((x) => x.id === s.id);
          if (!cur) {
            runtime.createSignature({
              mapSystemId: s.mapSystemId,
              sigId: s.sigId,
              groupKey: s.groupKey,
              activityOverride: s.activityOverride,
              typeId: s.typeId,
              eolStage: s.eolStage,
              name: s.name,
              description: s.description,
              mapConnectionId: s.mapConnectionId,
              expiresAt: s.expiresAt,
            });
          } else {
            runtime.patchSignature(s.id, patchBodyFromSnapshot(s));
          }
        }
      } else {
        runtime.bulkPaste(payload.forwardPayloads);
      }
      break;
    }
    default: {
      const _x: never = payload;
      void _x;
    }
  }
}

export function snapshotPatchInverse(
  prev: MapSignature,
  patch: UpdateSignatureBody,
): UpdateSignatureBody {
  const inverse: UpdateSignatureBody = {};
  for (const key of Object.keys(patch) as (keyof UpdateSignatureBody)[]) {
  const k = key;
    (inverse as Record<string, unknown>)[k] = (prev as Record<string, unknown>)[k];
  }
  return inverse;
}
