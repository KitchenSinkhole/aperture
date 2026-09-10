import type { MapConnectionEdge, MapSignature, MapSystemNode } from '@/types';

/** The read-only context a bookmark scheme names a wormhole transit from. */
export interface BookmarkInput {
  here: MapSystemNode;
  cameFrom: MapSystemNode;
  /** The wormhole traversed. */
  connection: MapConnectionEdge;
  /**
   * Every connection on the map, so a scheme can answer topology questions
   * about the chain beyond the hole being crossed — how many holes hang off an
   * endpoint, whether an endpoint is joined to Home by a static-flagged
   * connection it did not arrive through, which `ap_map_system.id`s are
   * reachable from either endpoint and at what hop count. The edges carry
   * `ap_map_system.id`s only: `here` and `cameFrom` are the sole full system
   * nodes, so no other system's name, tag, security or statics is readable.
   * Includes `connection` itself.
   */
  connections: MapConnectionEdge[];
  /**
   * Signatures whose `mapConnectionId` is this connection — up to one per side,
   * in any order. Select by `mapSystemId`.
   */
  signatures: MapSignature[];
  /** Hops from Home per `ap_map_system.id`. Absent = unreachable, or no Home. */
  hopsFromHome: ReadonlyMap<string, number>;
  /** `ap_map_system.id` of the map's Home; null when none is set. */
  homeMapSystemId: string | null;
}

/** The strategy contract every bookmark naming scheme implements. */
export interface BookmarkScheme {
  /**
   * The bookmark to write in each system. Null offers nothing — a legitimate
   * answer for a hole the convention has no name for.
   */
  names(input: BookmarkInput): { here: string; cameFrom: string } | null;
}
