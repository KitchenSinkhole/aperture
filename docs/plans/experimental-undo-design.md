# Experimental map undo (Ctrl+Z) — design barrier

**Status:** Not implemented. QoL item (e) stops here per PD.

## Why not a quick client hack

- Every mutation is one `commitMapEvent` with no inverse payload in `ap_map_event`.
- Deletes are hard (connections) or soft-hide (systems); restores need pre-images.
- Bulk signature paste is N events in one transaction.
- `applyEvent` is forward-only; optimistic rollback is error recovery, not user undo.

## Recommended approach (future)

1. **Client undo stack** (experimental only): ring buffer of `{ label, revert: () => Promise<void> }` where `revert` calls the same JSON API routes with inverse patches captured at apply time (store full pre-image for the affected entity ids).
2. **Depth cap** 20; merge rapid identical patches within 300ms.
3. **No schema change** if revert uses existing mutation endpoints.
4. **Ctrl+Z** in `MapCanvas` when experimental and stack non-empty; never for spectator.

## Risk

Cross-tab undo is unsynchronized; document as single-tab only.
