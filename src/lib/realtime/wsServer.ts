import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { decode } from 'next-auth/jwt';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { apCharacter } from '@/db/schema';
import { env } from '@/lib/env';
import { apertureConfig } from '../../../aperture.config';
import {
  getBlackoutState,
  isBlackedOut,
  isBlackoutCleared,
  isPilotHidden,
} from '@/lib/auth/blackout';
import { canViewMap } from '@/lib/auth/rights';
import { getBuildId } from '@/lib/buildId';
import { clientKeyFromForwardedFor } from '@/lib/http/clientKey';
import { seedTrackingForMap } from '@/lib/jobs/tracking';
import { getLogger } from '@/lib/log/logger';
import { resolveShareToken } from '@/lib/map/share';
import { recordPublicWsUpgrade } from '@/lib/metrics/registry';
import type { BlackoutState, BlackoutViewer, ShareRedactionProfile } from '@/types';
import { bus } from './bus';
import { addMapViewer, removeMapViewer } from './mapViewers';
import { openPresenceSession, touchPresenceSessions } from './presenceSessions';
import { allowPublicUpgrade, publicSocketCount, registerPublicSocket } from './publicSockets';
import { decWsConnection, incWsConnection } from './wsConnections';
import {
  clientToServerMessageSchema,
  type BlackoutStatus,
  type ServerToClientMessage,
} from './protocol';

const wsLog = getLogger('server');

/**
 * Node-runtime WebSocket server attached to the same HTTP server as Next.js.
 * Broadcast-only: clients send `subscribe` / `unsubscribe`; the
 * server fans `mapUpdate` envelopes sourced from the Postgres LISTEN bus.
 *
 * Authorization is the Auth.js session, read off the upgrade request's cookies.
 * Subscriptions are gated by `canViewMap` — a request for a map the
 * actor can't see is silently dropped (no acknowledgement; we don't leak
 * existence over realtime any more than we do over HTTP).
 *
 * A second upgrade path, `apertureConfig.WS_PUBLIC_PATH`, authenticates
 * anonymous spectator sockets via a share token in the query string
 * (`resolveShareToken`) and pins each socket to that one map. Public sockets
 * never send a meaningful frame and receive only `publicUpdate` — see
 * `handlePublicUpgrade` below.
 *
 * Blackout is enforced here, on the way out: a session socket whose account
 * isn't cleared gets presence only for its own account and no mass log
 * (`filterSessionMessage`), and public sockets get no presence nudge
 * (`publicActionFor`). The browser is never trusted to hide anything.
 */

type SessionClaims = { userId: number; characterId: string };

type ClientState = {
  session: SessionClaims;
  isAlive: boolean;
  /** mapId → bus unsubscribe fn. */
  subscriptions: Map<bigint, () => void>;
  presenceSessionId: bigint | null;
  /** On the Blackout cleared list. False until first resolved, so filtering fails closed. */
  blackoutCleared: boolean;
  /** Every character on the account, any status: what a `characterLogout` may name. */
  ownCharacterIds: ReadonlySet<number>;
  /** Bumped per standing lookup so a slower, older lookup can't overwrite a newer one. */
  standingSeq: number;
};

type AccountStanding = { cleared: boolean; characterIds: Set<number> };

type PublicUpgradeCtx = {
  token: string;
  mapId: bigint;
  profile: ShareRedactionProfile;
};

type PublicClientState = {
  ctx: PublicUpgradeCtx;
  isAlive: boolean;
  unsubscribeBus: () => void;
  deregister: () => void;
  lastNudgeAt: number;
  pendingNudge: NodeJS.Timeout | null;
};

// Auth.js v5 session-cookie names. The salt passed to `decode` is the cookie
// name itself (v5 derives the encryption key from secret + salt).
const COOKIE_NAMES = [
  '__Secure-authjs.session-token',
  'authjs.session-token',
] as const;

function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) out.set(name, decodeURIComponent(value));
  }
  return out;
}

async function resolveSession(req: IncomingMessage): Promise<SessionClaims | null> {
  if (!env.AUTH_SECRET) return null;
  const cookies = parseCookies(req.headers.cookie);
  for (const name of COOKIE_NAMES) {
    const token = cookies.get(name);
    if (!token) continue;
    try {
      const claims = await decode({ token, secret: env.AUTH_SECRET, salt: name });
      if (claims?.characterId && claims.userId != null) {
        return { userId: claims.userId, characterId: claims.characterId };
      }
    } catch {
      // Try the next cookie name; fall through to reject.
    }
  }
  return null;
}

function send(socket: WebSocket, message: ServerToClientMessage): void {
  wsLog.debug('Sending message to client', { task: message.task });
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function destroyUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\n\r\n`);
  socket.destroy();
}

function nodeHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function publicClientKey(req: IncomingMessage): string {
  return clientKeyFromForwardedFor(
    nodeHeaderValue(req.headers['x-forwarded-for']),
    nodeHeaderValue(req.headers['x-real-ip']),
  );
}

/** Map ids the actor can view (existence + soft-delete + view rights). */
async function viewableMapIds(
  characterId: bigint,
  mapIds: number[],
): Promise<Set<bigint>> {
  if (mapIds.length === 0) return new Set();
  const checks = await Promise.all(
    mapIds.map(async (raw) => {
      const id = BigInt(raw);
      return (await canViewMap(characterId, id)) ? id : null;
    }),
  );
  return new Set(checks.filter((x): x is bigint => x !== null));
}

async function accountStanding(userId: number): Promise<AccountStanding> {
  const [cleared, rows] = await Promise.all([
    isBlackoutCleared(userId),
    db.select({ id: apCharacter.id }).from(apCharacter).where(eq(apCharacter.userId, userId)),
  ]);
  return { cleared, characterIds: new Set(rows.map((r) => Number(r.id))) };
}

/**
 * What a session socket receives of one bus message: the message, a narrowed
 * copy, or null to drop it. While Blackout restricts the viewer, presence passes
 * only for the viewer's own account and the mass log not at all; every other
 * task passes unchanged.
 */
export function filterSessionMessage(
  message: ServerToClientMessage,
  viewer: BlackoutViewer,
  ownCharacterIds: ReadonlySet<number>,
): ServerToClientMessage | null {
  if (!isBlackedOut(viewer)) return message;
  switch (message.task) {
    case 'characterUpdate':
      return isPilotHidden(viewer, message.load.userId) ? null : message;
    case 'characterLogout': {
      const characterIds = message.load.characterIds.filter((id) => ownCharacterIds.has(id));
      if (characterIds.length === 0) return null;
      if (characterIds.length === message.load.characterIds.length) return message;
      return { ...message, load: { characterIds } };
    }
    case 'connectionMassLog':
      return null;
    default:
      return message;
  }
}

/**
 * How a public socket answers one bus message: `nudge` (a data-free
 * `publicUpdate`), `close` (the map is gone), or null to drop it. The bus
 * message itself is never forwarded, so this allowlist is the one place a public
 * socket could leak map data, and it structurally can't. Presence nudges only
 * when the share publishes presence and Blackout is off.
 */
export function publicActionFor(
  message: ServerToClientMessage,
  profile: ShareRedactionProfile,
  blackoutActive: boolean,
): 'nudge' | 'close' | null {
  switch (message.task) {
    case 'mapUpdate':
      return 'nudge';
    case 'characterUpdate':
    case 'characterLogout':
      return profile.presenceMode !== 'none' && !blackoutActive ? 'nudge' : null;
    case 'mapDeleted':
      return 'close';
    default:
      // healthCheck / systemNotification / connectionMassLog / mapAccess /
      // mapConnectionAccess / logData carry nothing a redacted public view
      // renders.
      return null;
  }
}

let attached = false;

export function attachWsServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Map<WebSocket, ClientState>();

  const publicWss = new WebSocketServer({ noServer: true });
  const publicClients = new Map<WebSocket, PublicClientState>();

  // Null until first read. Presence filtering treats an unknown state as on.
  let blackout: BlackoutState | null = null;
  let blackoutReadSeq = 0;

  async function refreshBlackout(): Promise<void> {
    const seq = ++blackoutReadSeq;
    try {
      const next = await getBlackoutState();
      if (seq === blackoutReadSeq) blackout = next;
    } catch (err) {
      wsLog.warn('Blackout state read failed', { error: String(err) });
    }
  }

  const blackoutLoaded = refreshBlackout();

  function viewerOf(state: ClientState): BlackoutViewer {
    return {
      active: blackout?.active ?? true,
      cleared: state.blackoutCleared,
      userId: state.session.userId,
    };
  }

  function blackoutStatus(state: ClientState): BlackoutStatus | undefined {
    if (!blackout) return undefined;
    return {
      active: blackout.active,
      since: blackout.since?.toISOString() ?? null,
      cleared: state.blackoutCleared,
    };
  }

  function sendHealthCheck(ws: WebSocket, state: ClientState): void {
    send(ws, {
      task: 'healthCheck',
      load: { ts: Date.now(), ok: true, build: getBuildId(), blackout: blackoutStatus(state) },
    });
  }

  /**
   * Re-resolve clearance and own characters for these sockets, one lookup per
   * account. A failed lookup keeps the socket's previous standing. Returns the
   * sockets whose clearance changed.
   */
  async function resolveStanding(
    entries: Array<[WebSocket, ClientState]>,
  ): Promise<Array<[WebSocket, ClientState]>> {
    const lookups = new Map<number, Promise<AccountStanding | null>>();
    const changed: Array<[WebSocket, ClientState]> = [];
    await Promise.all(
      entries.map(async (entry) => {
        const [, state] = entry;
        const seq = ++state.standingSeq;
        const { userId } = state.session;
        let lookup = lookups.get(userId);
        if (!lookup) {
          lookup = accountStanding(userId).catch((err: unknown) => {
            wsLog.warn('Blackout clearance lookup failed', { userId, error: String(err) });
            return null;
          });
          lookups.set(userId, lookup);
        }
        const standing = await lookup;
        if (!standing || seq !== state.standingSeq) return;
        if (standing.cleared !== state.blackoutCleared) changed.push(entry);
        state.blackoutCleared = standing.cleared;
        state.ownCharacterIds = standing.characterIds;
      }),
    );
    return changed;
  }

  const offInstanceNotify = bus.onInstanceNotify(() => {
    void (async () => {
      await refreshBlackout();
      const entries = [...clients];
      await resolveStanding(entries);
      for (const [ws, state] of entries) sendHealthCheck(ws, state);
    })();
  });

  async function handlePublicUpgrade(
    token: string | null,
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    if (!allowPublicUpgrade(publicClientKey(req))) {
      recordPublicWsUpgrade('rate_limited');
      destroyUpgrade(socket, 429, 'Too Many Requests');
      return;
    }
    const resolved = token ? await resolveShareToken(token) : null;
    if (!resolved || !token) {
      // Missing/garbage/unknown/expired/revoked all answer identically — the
      // same non-disclosure discipline as the snapshot route.
      recordPublicWsUpgrade('unauthorized');
      destroyUpgrade(socket, 401, 'Unauthorized');
      return;
    }
    if (publicSocketCount(token) >= apertureConfig.PUBLIC_WS_MAX_PER_TOKEN) {
      // The client reads a rejected upgrade as "degrade to polling".
      recordPublicWsUpgrade('at_cap');
      destroyUpgrade(socket, 503, 'Service Unavailable');
      return;
    }

    recordPublicWsUpgrade('accepted');
    const ctx: PublicUpgradeCtx = { token, mapId: resolved.mapId, profile: resolved.profile };
    publicWss.handleUpgrade(req, socket, head, (ws) => {
      publicWss.emit('connection', ws, req, ctx);
    });
  }

  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const { pathname, searchParams } = new URL(req.url ?? '', 'http://localhost');

    if (pathname === apertureConfig.WS_PUBLIC_PATH) {
      void handlePublicUpgrade(searchParams.get('token'), req, socket, head);
      return;
    }
    if (pathname !== apertureConfig.WS_PATH) return; // not ours — leave for Next/HMR.

    void resolveSession(req).then((session) => {
      if (!session) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req, session);
      });
    });
  });

  publicWss.on('connection', (ws: WebSocket, _req: IncomingMessage, ctx: PublicUpgradeCtx) => {
    const state: PublicClientState = {
      ctx,
      isAlive: true,
      unsubscribeBus: () => {},
      deregister: () => {},
      lastNudgeAt: 0,
      pendingNudge: null,
    };

    function nudge(): void {
      const now = Date.now();
      const elapsed = now - state.lastNudgeAt;
      if (elapsed >= apertureConfig.PUBLIC_WS_NUDGE_MIN_INTERVAL_MS) {
        state.lastNudgeAt = now;
        send(ws, { task: 'publicUpdate', load: { ts: now } });
        return;
      }
      // A nudge is already due within the interval; let it cover this one too.
      if (state.pendingNudge) return;
      state.pendingNudge = setTimeout(() => {
        state.pendingNudge = null;
        state.lastNudgeAt = Date.now();
        send(ws, { task: 'publicUpdate', load: { ts: state.lastNudgeAt } });
      }, apertureConfig.PUBLIC_WS_NUDGE_MIN_INTERVAL_MS - elapsed);
    }

    state.unsubscribeBus = bus.subscribe(ctx.mapId, (message) => {
      const action = publicActionFor(message, ctx.profile, blackout?.active ?? true);
      if (action === 'nudge') nudge();
      else if (action === 'close') ws.close(4001, 'map deleted');
    });
    state.deregister = registerPublicSocket(ctx.token, (code) => ws.close(code));
    publicClients.set(ws, state);

    ws.on('pong', () => {
      state.isAlive = true;
    });

    // Public sockets are broadcast-only in both directions: unlike the
    // session path there is no `subscribe`/`unsubscribe` to honor, so any
    // inbound frame is simply dropped.
    ws.on('message', () => {});

    ws.on('close', () => {
      if (state.pendingNudge) clearTimeout(state.pendingNudge);
      state.unsubscribeBus();
      state.deregister();
      publicClients.delete(ws);
    });
  });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, session: SessionClaims) => {
    const state: ClientState = {
      session,
      isAlive: true,
      subscriptions: new Map(),
      presenceSessionId: null,
      blackoutCleared: false,
      ownCharacterIds: new Set(),
      standingSeq: 0,
    };
    clients.set(ws, state);
    incWsConnection();
    // The build id rides the heartbeat, but a client that just reconnected
    // through a deploy must not wait a full WS_HEARTBEAT_MS to learn it changed.
    // Sent once this socket's Blackout standing is known, since it carries it.
    void Promise.all([blackoutLoaded, resolveStanding([[ws, state]])]).then(() =>
      sendHealthCheck(ws, state),
    );
    void openPresenceSession(BigInt(session.characterId)).then((id) => {
      state.presenceSessionId = id;
    });

    ws.on('pong', () => {
      state.isAlive = true;
    });

    ws.on('message', (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return; // drop malformed frame
      }
      const result = clientToServerMessageSchema.safeParse(parsed);
      if (!result.success) return;

      const { task, load } = result.data;
      if (task === 'subscribe') {
        void subscribe(ws, state, load.mapIds);
      } else {
        unsubscribe(state, load.mapIds);
      }
    });

    ws.on('close', () => {
      for (const [id, off] of state.subscriptions) {
        off();
        removeMapViewer(id, state.session.userId);
      }
      state.subscriptions.clear();
      clients.delete(ws);
      decWsConnection();
      if (state.presenceSessionId !== null) {
        void touchPresenceSessions([state.presenceSessionId]);
      }
    });
  });

  async function subscribe(ws: WebSocket, state: ClientState, mapIds: number[]): Promise<void> {
    const characterId = BigInt(state.session.characterId);
    const allowed = await viewableMapIds(characterId, mapIds);
    for (const id of allowed) {
      if (!state.subscriptions.has(id)) {
        const off = bus.subscribe(id, (message) => {
          const out = filterSessionMessage(message, viewerOf(state), state.ownCharacterIds);
          if (out) send(ws, out);
        });
        state.subscriptions.set(id, off);
        // This account now has the map open — count it toward the viewer roster.
        // Keyed by account, not character: coverage extends to all of the
        // account's alts (see mapViewers.ts).
        addMapViewer(id, state.session.userId);
      }
    }
    // Per-map default (per-map-character-tracking plan): the first time this
    // account opens a map, seed a tracking row for every active character;
    // after that the marker stands and the user's explicit per-map selection
    // (including an empty one) is left untouched. Idempotent per (map, account).
    for (const id of allowed) {
      void seedTrackingForMap({ mapId: id, userId: state.session.userId });
    }
  }

  function unsubscribe(state: ClientState, mapIds: number[]): void {
    for (const raw of mapIds) {
      const id = BigInt(raw);
      const off = state.subscriptions.get(id);
      if (off) {
        off();
        state.subscriptions.delete(id);
        removeMapViewer(id, state.session.userId);
      }
    }
  }

  // Heartbeat: ws ping for transport liveness + an app-level healthCheck so the
  // client clears its degraded banner even on a quiet map. Public sockets get
  // the transport ping only — they have no degraded banner and no app-level
  // vocabulary beyond `publicUpdate`.
  const heartbeat = setInterval(() => {
    const livePresenceIds: bigint[] = [];
    const live: Array<[WebSocket, ClientState]> = [];
    for (const [ws, state] of clients) {
      if (!state.isAlive) {
        ws.terminate();
        continue;
      }
      state.isAlive = false;
      ws.ping();
      sendHealthCheck(ws, state);
      live.push([ws, state]);
      if (state.presenceSessionId !== null) livePresenceIds.push(state.presenceSessionId);
    }
    if (!blackout) void refreshBlackout();
    // Grant expiry and title changes from the authz resync send no instance
    // notify, so while Blackout is on clearance is re-resolved every beat.
    if (blackout?.active) {
      void resolveStanding(live).then((changed) => {
        for (const [ws, state] of changed) sendHealthCheck(ws, state);
      });
    }
    for (const [ws, state] of publicClients) {
      if (!state.isAlive) {
        ws.terminate();
        continue;
      }
      state.isAlive = false;
      ws.ping();
    }
    void touchPresenceSessions(livePresenceIds);
  }, apertureConfig.WS_HEARTBEAT_MS);
  heartbeat.unref?.();

  wss.on('close', () => {
    clearInterval(heartbeat);
    offInstanceNotify();
  });
  attached = true;
  return wss;
}

/** Whether {@link attachWsServer} has run in this process. Exposed for tests/health. */
export function isWsServerAttached(): boolean {
  return attached;
}
