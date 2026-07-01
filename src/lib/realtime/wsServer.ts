import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { decode } from 'next-auth/jwt';
import { env } from '@/lib/env';
import { apertureConfig } from '../../../aperture.config';
import { canViewMap } from '@/lib/auth/rights';
import { seedTrackingForMap } from '@/lib/jobs/tracking';
import { getLogger } from '@/lib/log/logger';
import { bus } from './bus';
import { addMapViewer, removeMapViewer } from './mapViewers';
import { decWsConnection, incWsConnection } from './wsConnections';
import { clientToServerMessageSchema, type ServerToClientMessage } from './protocol';

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
 */

type SessionClaims = { userId: number; characterId: string };

type ClientState = {
  session: SessionClaims;
  isAlive: boolean;
  /** mapId → bus unsubscribe fn. */
  subscriptions: Map<bigint, () => void>;
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

let attached = false;

export function attachWsServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Map<WebSocket, ClientState>();

  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const { pathname } = new URL(req.url ?? '', 'http://localhost');
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

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, session: SessionClaims) => {
    const state: ClientState = { session, isAlive: true, subscriptions: new Map() };
    clients.set(ws, state);
    incWsConnection();

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
    });
  });

  async function subscribe(ws: WebSocket, state: ClientState, mapIds: number[]): Promise<void> {
    const characterId = BigInt(state.session.characterId);
    const allowed = await viewableMapIds(characterId, mapIds);
    for (const id of allowed) {
      if (!state.subscriptions.has(id)) {
        const off = bus.subscribe(id, (message) => send(ws, message));
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
  // client clears its degraded banner even on a quiet map.
  const heartbeat = setInterval(() => {
    for (const [ws, state] of clients) {
      if (!state.isAlive) {
        ws.terminate();
        continue;
      }
      state.isAlive = false;
      ws.ping();
      send(ws, { task: 'healthCheck', load: { ts: Date.now(), ok: true } });
    }
  }, apertureConfig.WS_HEARTBEAT_MS);
  heartbeat.unref?.();

  wss.on('close', () => clearInterval(heartbeat));
  attached = true;
  return wss;
}

/** Whether {@link attachWsServer} has run in this process. Exposed for tests/health. */
export function isWsServerAttached(): boolean {
  return attached;
}
