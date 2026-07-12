import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import type { Session } from 'next-auth';
import { db } from '@/db/client';
import { apMap } from '@/db/schema';
import {
  requireMapCapability as requireMapCapabilityInner,
  requireMapRight,
  requireMapView as requireMapViewInner,
  type RightGuard,
} from '@/lib/auth/rights';
import type { MapCapability, MapRight } from '@/types';

/**
 * Shared guard helpers for the `/api/map/**` route layer. The four concerns
 * (id parsing, map-existence check, session check, right check) are wrapped
 * into two ergonomic helpers — `requireMapMutate` for write endpoints and
 * `requireMapView` for read endpoints — so each route stays concise.
 *
 * The lower-level `parseBigInt` and `guardMap` remain available for callers
 * that need the no-rights map-existence check (e.g. presence queries or
 * read-only endpoints under different access models).
 */

/** Parse a URL segment that must be a positive-integer string. Returns null on failure. */
export function parseBigInt(s: string): bigint | null {
  if (!/^\d+$/.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

/**
 * Verify a map exists and is not soft-deleted. Returns `{ mapId }` on success,
 * or `null` when the map is missing or has `deleted_at` set. Callers should
 * return HTTP 404 on null. This bypasses per-map rights — only use it from
 * paths that genuinely need that (e.g. realtime subscribe filtering before the
 * session is fully resolved).
 */
export async function guardMap(rawId: string): Promise<{ mapId: bigint } | null> {
  const mapId = parseBigInt(rawId);
  if (!mapId) return null;
  const [row] = await db
    .select({ id: apMap.id })
    .from(apMap)
    .where(and(eq(apMap.id, mapId), isNull(apMap.deletedAt)));
  return row ? { mapId: row.id } : null;
}

/** Discriminated tuple returned by the combined helpers. */
export type MapAccessGuard =
  | { ok: true; mapId: bigint; characterId: bigint }
  | { ok: false; status: 400 | 401 | 403 | 404; error: string };

/**
 * Combined session + parse + view + right check for write endpoints —
 * every mutation under `/api/map/**` runs this before touching
 * the DB. The 404 case covers both "map does not exist" and "you cannot see
 * this map" to avoid leaking existence.
 */
export async function requireMapMutate(
  rawMapId: string,
  session: Session | null | undefined,
  right: MapRight,
): Promise<MapAccessGuard> {
  const mapId = parseBigInt(rawMapId);
  if (!mapId) return { ok: false, status: 400, error: 'Invalid map id.' };
  const guard: RightGuard = await requireMapRight(session, mapId, right);
  if (!guard.ok) return guard;
  return { ok: true, mapId, characterId: guard.characterId };
}

/** Combined session + parse + view check for read endpoints. */
export async function requireMapView(
  rawMapId: string,
  session: Session | null | undefined,
): Promise<MapAccessGuard> {
  const mapId = parseBigInt(rawMapId);
  if (!mapId) return { ok: false, status: 400, error: 'Invalid map id.' };
  const guard: RightGuard = await requireMapViewInner(session, mapId);
  if (!guard.ok) return guard;
  return { ok: true, mapId, characterId: guard.characterId };
}

/**
 * Combined session + parse + delegated-capability check for a per-map feature
 * endpoint (audit / webhooks / import / export / delete). Wraps
 * `requireMapCapability` with the id parse so the raw URL segment is handled in
 * one place. The 404 case covers both "map does not exist" and "you cannot see
 * this map"; 403 is view-access-OK-but-lacking-the-capability.
 */
export async function requireMapCapability(
  rawMapId: string,
  session: Session | null | undefined,
  capability: MapCapability,
): Promise<MapAccessGuard> {
  const mapId = parseBigInt(rawMapId);
  if (!mapId) return { ok: false, status: 400, error: 'Invalid map id.' };
  const guard: RightGuard = await requireMapCapabilityInner(session, mapId, capability);
  if (!guard.ok) return guard;
  return { ok: true, mapId, characterId: guard.characterId };
}
