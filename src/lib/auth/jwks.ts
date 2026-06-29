import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import { z } from 'zod';
import { apertureConfig } from '../../../aperture.config';
import { env } from '@/lib/env';
import { recordJwkRefresh } from '@/lib/metrics/registry';

// EVE SSO issues a JWT *access token* (no OIDC id_token). We verify it against
// CCP's published JWK set. `createRemoteJWKSet`'s `cooldownDuration` enforces
// the "one re-fetch per 10s" cap on unknown-kid reloads,
// while still refreshing on a signature failure after the cooldown elapses.

function jwksUri(): URL {
  return new URL(apertureConfig.SSO_JWKS_PATH, env.AUTH_EVE_SSO_BASE);
}

// Counts genuine remote JWKS fetches (cache refreshes — the thing capped at one
// per 10s), not per-token verifies: jose only invokes this when it actually
// reloads the key set.
const instrumentedFetch: typeof fetch = async (...args) => {
  try {
    const res = await fetch(...args);
    recordJwkRefresh('success');
    return res;
  } catch (err) {
    recordJwkRefresh('error');
    throw err;
  }
};

let keySet: ReturnType<typeof createRemoteJWKSet> | null = null;

function eveKeySet(): ReturnType<typeof createRemoteJWKSet> {
  if (!keySet) {
    keySet = createRemoteJWKSet(jwksUri(), {
      cooldownDuration: apertureConfig.JWK_REFETCH_MIN_INTERVAL_MS,
      [customFetch]: instrumentedFetch,
    });
  }
  return keySet;
}

/** Test-only: drop the cached key set so a fresh fetch/cooldown cycle can be observed. */
export function __resetEveKeySetForTest(): void {
  keySet = null;
}

// The subset of EVE SSO JWT claims we rely on. `sub` is `CHARACTER:EVE:<id>`;
// `scp` is a single string for one scope, an array for many; `owner` is the
// account-ownership hash. Decoded with Zod so SSO drift surfaces as an error.
const eveClaimsSchema = z.object({
  sub: z.string().regex(/^CHARACTER:EVE:\d+$/),
  name: z.string(),
  owner: z.string(),
  scp: z.union([z.string(), z.array(z.string())]).optional(),
});

export interface EveAccessTokenClaims {
  characterId: bigint;
  name: string;
  ownerHash: string;
  scopes: string[];
}

/**
 * Verify an EVE SSO access token against CCP's JWK set and return the decoded
 * character claims. Throws on signature failure, issuer/audience mismatch, or
 * claim-shape drift.
 */
export async function verifyEveAccessToken(token: string): Promise<EveAccessTokenClaims> {
  const { payload } = await jwtVerify(token, eveKeySet(), {
    issuer: [...apertureConfig.SSO_EXPECTED_ISSUER],
    audience: env.AUTH_EVE_CLIENT_ID,
  });
  const claims = eveClaimsSchema.parse(payload);
  const scopes = claims.scp === undefined ? [] : Array.isArray(claims.scp) ? claims.scp : [claims.scp];
  return {
    characterId: BigInt(claims.sub.split(':')[2]!),
    name: claims.name,
    ownerHash: claims.owner,
    scopes,
  };
}
