'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { MapPresenceEntry } from '@/lib/map/loadMap';
import {
  characterLogoutLoadSchema,
  characterUpdateLoadSchema,
  type CharacterUpdateLoad,
  type Envelope,
} from '@/lib/realtime/protocol';
import { useRealtimeEvents } from '@/lib/realtime/useRealtime';

// Client-side fan-in for the pilot-presence badge on `SystemNode`.
//
// The store is keyed by EVE solar-system id. It's seeded from `MapViewData.presence`
// (server-loaded online + located tracked pilots) and then folds incoming
// `characterUpdate` envelopes on top. Each SystemNode subscribes only to its
// own system's slice via `useSyncExternalStore`, so a single character moving
// re-renders at most two nodes (the source and the destination) instead of
// every node on the map.

type Subscriber = () => void;

/**
 * A detected jump of one tracked pilot between two systems, keyed by EVE
 * solar-system id. Emitted by the presence store the moment it folds a
 * `characterUpdate` that moves an online pilot from one located system to
 * another. The travel-animation bridge resolves these to a map edge + direction.
 */
export type Traversal = {
  characterId: number;
  fromSystemId: number;
  toSystemId: number;
  /** ISO timestamp the move was detected server-side (`characterUpdate.locationAt`). */
  at: string;
};

type TraversalSubscriber = (t: Traversal) => void;

const EMPTY: readonly MapPresenceEntry[] = Object.freeze([]) as readonly MapPresenceEntry[];

export class PresenceStore {
  private bySystem = new Map<number, MapPresenceEntry[]>();
  private byCharacterSystem = new Map<number, number>();
  private subs = new Map<number, Set<Subscriber>>();
  private allSubs = new Set<Subscriber>();
  private traversalSubs = new Set<TraversalSubscriber>();
  // Cached flattened snapshot for `usePresenceForMap`. `useSyncExternalStore`
  // requires the same reference between reads that don't mutate the store, so
  // we only rebuild this on `notify()`.
  private allCache: readonly MapPresenceEntry[] | null = null;

  seed(initial: MapPresenceEntry[]): void {
    const before = new Set<number>(this.bySystem.keys());
    const grouped = new Map<number, MapPresenceEntry[]>();
    const byChar = new Map<number, number>();
    for (const entry of initial) {
      const list = grouped.get(entry.systemId);
      if (list) list.push(entry);
      else grouped.set(entry.systemId, [entry]);
      byChar.set(entry.characterId, entry.systemId);
    }
    for (const list of grouped.values()) list.sort(byName);
    this.bySystem = grouped;
    this.byCharacterSystem = byChar;
    const changed = new Set<number>(before);
    for (const k of grouped.keys()) changed.add(k);
    this.notify(changed);
  }

  apply(load: CharacterUpdateLoad): void {
    const changed = new Set<number>();
    const prev = this.byCharacterSystem.get(load.characterId);
    if (prev !== undefined) {
      const list = this.bySystem.get(prev);
      if (list) {
        const next = list.filter((e) => e.characterId !== load.characterId);
        if (next.length === 0) this.bySystem.delete(prev);
        else this.bySystem.set(prev, next);
        changed.add(prev);
      }
      this.byCharacterSystem.delete(load.characterId);
    }

    // Hide offline pilots entirely — only insert when online AND located.
    if (load.online === true && load.systemId !== null && load.locationAt !== null) {
      const entry: MapPresenceEntry = {
        characterId: load.characterId,
        characterName: load.characterName,
        userId: load.userId,
        mainCharacterId: load.mainCharacterId,
        mainCharacterName: load.mainCharacterName,
        systemId: load.systemId,
        systemName: load.systemName,
        systemSecurity: load.systemSecurity,
        systemTrueSec: load.systemTrueSec,
        shipTypeId: load.shipTypeId,
        shipTypeName: load.shipTypeName,
        shipClass: load.shipClass,
        shipName: load.shipName,
        locationAt: load.locationAt,
      };
      const existing = this.bySystem.get(entry.systemId);
      const next = existing ? [...existing, entry] : [entry];
      next.sort(byName);
      this.bySystem.set(entry.systemId, next);
      this.byCharacterSystem.set(entry.characterId, entry.systemId);
      changed.add(entry.systemId);
    }

    this.notify(changed);

    // A real jump: the pilot was located in `prev`, is now online and located
    // in a different system. Offline transitions (no new system) and same-system
    // re-reports don't qualify. `seed()` never reaches here, so initial roster
    // placement doesn't animate.
    if (
      prev !== undefined &&
      load.online === true &&
      load.systemId !== null &&
      load.locationAt !== null &&
      prev !== load.systemId
    ) {
      this.emitTraversal({
        characterId: load.characterId,
        fromSystemId: prev,
        toSystemId: load.systemId,
        at: load.locationAt,
      });
    }
  }

  /**
   * Drop pilots from the roster outright (server-revoked access via a
   * `characterLogout` broadcast). Unlike an offline `characterUpdate`, there is
   * no breadcrumb to keep — the pilot should vanish from every system slice.
   */
  remove(characterIds: number[]): void {
    const changed = new Set<number>();
    for (const characterId of characterIds) {
      const systemId = this.byCharacterSystem.get(characterId);
      if (systemId === undefined) continue;
      const list = this.bySystem.get(systemId);
      if (list) {
        const next = list.filter((e) => e.characterId !== characterId);
        if (next.length === 0) this.bySystem.delete(systemId);
        else this.bySystem.set(systemId, next);
        changed.add(systemId);
      }
      this.byCharacterSystem.delete(characterId);
    }
    this.notify(changed);
  }

  subscribe(systemId: number, sub: Subscriber): () => void {
    let set = this.subs.get(systemId);
    if (!set) {
      set = new Set();
      this.subs.set(systemId, set);
    }
    set.add(sub);
    return () => {
      const s = this.subs.get(systemId);
      if (!s) return;
      s.delete(sub);
      if (s.size === 0) this.subs.delete(systemId);
    };
  }

  getForSystem(systemId: number): readonly MapPresenceEntry[] {
    return this.bySystem.get(systemId) ?? EMPTY;
  }

  /**
   * The EVE solar-system id one character is currently online + located in, or
   * null if it's offline / unlocated. Read live at event time (the store
   * instance is stable), so callers don't need to subscribe for this.
   */
  getSystemForCharacter(characterId: number): number | null {
    return this.byCharacterSystem.get(characterId) ?? null;
  }

  subscribeAll(sub: Subscriber): () => void {
    this.allSubs.add(sub);
    return () => {
      this.allSubs.delete(sub);
    };
  }

  subscribeTraversals(sub: TraversalSubscriber): () => void {
    this.traversalSubs.add(sub);
    return () => {
      this.traversalSubs.delete(sub);
    };
  }

  private emitTraversal(t: Traversal): void {
    for (const sub of this.traversalSubs) sub(t);
  }

  /** Every online + located pilot across the whole map, sorted by name. */
  getAll(): readonly MapPresenceEntry[] {
    if (this.allCache) return this.allCache;
    const flat: MapPresenceEntry[] = [];
    for (const list of this.bySystem.values()) flat.push(...list);
    flat.sort(byName);
    this.allCache = Object.freeze(flat);
    return this.allCache;
  }

  private notify(systemIds: Set<number>): void {
    if (systemIds.size === 0) return;
    // Any mutation invalidates the flattened snapshot and wakes map-wide subs.
    this.allCache = null;
    for (const id of systemIds) {
      const set = this.subs.get(id);
      if (!set) continue;
      for (const sub of set) sub();
    }
    for (const sub of this.allSubs) sub();
  }
}

function byName(a: MapPresenceEntry, b: MapPresenceEntry): number {
  return a.characterName.localeCompare(b.characterName);
}

const PresenceContext = createContext<PresenceStore | null>(null);

export function MapPresenceProvider({
  initial,
  children,
}: {
  initial: MapPresenceEntry[];
  children: ReactNode;
}) {
  // Seed synchronously so the first paint shows badges instead of empty +
  // flash-fill on the next tick.
  const [store] = useState(() => {
    const s = new PresenceStore();
    s.seed(initial);
    return s;
  });

  // Re-seed only when the server-sent presence reference actually changes
  // (e.g. on a soft navigation back to this map page). The first-mount call
  // is a no-op against the constructor seed.
  const seededRef = useRef(initial);
  useEffect(() => {
    if (seededRef.current === initial) return;
    seededRef.current = initial;
    store.seed(initial);
  }, [initial, store]);

  useRealtimeEvents(
    useCallback(
      (envelope: Envelope) => {
        if (envelope.task === 'characterUpdate') {
          const parsed = characterUpdateLoadSchema.safeParse(envelope.load);
          if (!parsed.success) return;
          store.apply(parsed.data);
          return;
        }
        if (envelope.task === 'characterLogout') {
          const parsed = characterLogoutLoadSchema.safeParse(envelope.load);
          if (!parsed.success) return;
          store.remove(parsed.data.characterIds);
          return;
        }
      },
      [store],
    ),
  );

  return <PresenceContext.Provider value={store}>{children}</PresenceContext.Provider>;
}

/**
 * Returns the pilot-presence slice for one EVE solar-system. The returned
 * array reference is stable until that system's slice changes (so the calling
 * component only re-renders when *its* system gains or loses a pilot).
 */
export function usePresenceForSystem(systemId: number): readonly MapPresenceEntry[] {
  const store = useContext(PresenceContext);
  const subscribe = useCallback(
    (cb: () => void) => store?.subscribe(systemId, cb) ?? (() => {}),
    [store, systemId],
  );
  const getSnapshot = useCallback(() => store?.getForSystem(systemId) ?? EMPTY, [store, systemId]);
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}

/**
 * Returns every online + located pilot across the whole map, sorted by name.
 * Re-renders the caller whenever any system's slice changes. Used by the
 * Map Info dialog (pilot count + Users roster).
 */
export function usePresenceForMap(): readonly MapPresenceEntry[] {
  const store = useContext(PresenceContext);
  const subscribe = useCallback((cb: () => void) => store?.subscribeAll(cb) ?? (() => {}), [store]);
  const getSnapshot = useCallback(() => store?.getAll() ?? EMPTY, [store]);
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}

/**
 * The presence store itself, for callers that need to read it live at event
 * time rather than subscribe to a slice (e.g. the CTRL+V paste handler checking
 * "is any of my characters in the selected system?"). The store instance is
 * stable for the provider's lifetime. Null outside a provider.
 */
export function usePresenceStore(): PresenceStore | null {
  return useContext(PresenceContext);
}

/**
 * Subscribes to pilot jumps (see `Traversal`). The callback may change every
 * render without re-subscribing — only the latest is invoked. Used by the
 * travel-animation bridge to drive the moving-dot effect.
 */
export function useTraversals(cb: (t: Traversal) => void): void {
  const store = useContext(PresenceContext);
  const cbRef = useRef(cb);
  useEffect(() => {
    cbRef.current = cb;
  });
  useEffect(() => {
    if (!store) return;
    return store.subscribeTraversals((t) => cbRef.current(t));
  }, [store]);
}
