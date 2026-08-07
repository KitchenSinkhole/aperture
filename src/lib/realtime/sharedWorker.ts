import { apertureConfig } from '../../../aperture.config';
import { envelopeSchema, type Envelope } from './protocol';

/**
 * SharedWorker body — one WebSocket per browser origin, multiplexed across every
 * tab of a character. Tabs connect a MessagePort; the worker tracks, per map,
 * the set of ports subscribed to it, so a `subscribe` frame goes out only when
 * the first tab wants a map and `unsubscribe` only when the last leaves. A
 * map-scoped inbound envelope (carries `mapId`) is routed only to the ports
 * subscribed to that map; a control-plane frame (no `mapId`, e.g. `healthCheck`)
 * and connection-state changes fan to all ports.
 *
 * The socket is broadcast-only from the server's side; the only frames this
 * worker sends are `subscribe` / `unsubscribe` (protocol.ts).
 */

// Messages exchanged with each tab port. Kept local to the realtime module.
type PortInbound =
  | { type: 'subscribe'; mapId: number }
  | { type: 'unsubscribe'; mapId: number };

type ConnStatus = 'connecting' | 'open' | 'closed' | 'degraded';

type PortOutbound =
  | { type: 'status'; status: ConnStatus }
  | { type: 'message'; envelope: Envelope };

const ports = new Set<MessagePort>();
/** mapId → ports currently subscribed. */
const subscriptions = new Map<number, Set<MessagePort>>();

let socket: WebSocket | null = null;
let status: ConnStatus = 'closed';
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function wsUrl(): string {
  const scheme = self.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${self.location.host}${apertureConfig.WS_PATH}`;
}

function broadcast(message: PortOutbound): void {
  for (const port of ports) port.postMessage(message);
}

function setStatus(next: ConnStatus): void {
  if (status === next) return;
  status = next;
  broadcast({ type: 'status', status });
}

function activeMapIds(): number[] {
  return [...subscriptions.keys()];
}

function sendFrame(task: 'subscribe' | 'unsubscribe', mapIds: number[]): void {
  if (mapIds.length === 0) return;
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ task, load: { mapIds } }));
  }
}

function connect(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  setStatus('connecting');
  const ws = new WebSocket(wsUrl());
  socket = ws;

  ws.onopen = () => {
    reconnectAttempts = 0;
    setStatus('open');
    // Replay every active subscription so a reconnect re-homes all tabs.
    sendFrame('subscribe', activeMapIds());
  };

  ws.onmessage = (event) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof event.data === 'string' ? event.data : '');
    } catch {
      return;
    }
    const result = envelopeSchema.safeParse(parsed);
    if (!result.success) return;
    const envelope = result.data;
    if (typeof envelope.mapId === 'number') {
      const subs = subscriptions.get(envelope.mapId);
      if (!subs) return;
      const message: PortOutbound = { type: 'message', envelope };
      for (const port of subs) port.postMessage(message);
    } else {
      broadcast({ type: 'message', envelope });
    }
  };

  ws.onclose = () => {
    socket = null;
    setStatus('degraded');
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose follows; reconnect is scheduled there.
    setStatus('degraded');
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  if (subscriptions.size === 0 && ports.size === 0) {
    setStatus('closed');
    return;
  }
  const delay = Math.min(
    apertureConfig.WS_RECONNECT_BASE_MS * 2 ** reconnectAttempts,
    apertureConfig.WS_RECONNECT_MAX_MS,
  );
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function addSubscription(port: MessagePort, mapId: number): void {
  let subs = subscriptions.get(mapId);
  if (!subs) {
    subs = new Set();
    subscriptions.set(mapId, subs);
  }
  const wasEmpty = subs.size === 0;
  subs.add(port);
  if (wasEmpty) {
    connect();
    sendFrame('subscribe', [mapId]);
  }
}

function removeSubscription(port: MessagePort, mapId: number): void {
  const subs = subscriptions.get(mapId);
  if (!subs) return;
  subs.delete(port);
  if (subs.size === 0) {
    subscriptions.delete(mapId);
    sendFrame('unsubscribe', [mapId]);
  }
}

function handlePortMessage(port: MessagePort, message: PortInbound): void {
  if (message.type === 'subscribe') addSubscription(port, message.mapId);
  else removeSubscription(port, message.mapId);
}

self.addEventListener('connect', (event) => {
  const port = (event as MessageEvent).ports[0];
  if (!port) return;
  ports.add(port);

  port.onmessage = (e: MessageEvent) => handlePortMessage(port, e.data as PortInbound);
  port.start();

  // Hand the new tab the current status immediately so its banner is accurate.
  port.postMessage({ type: 'status', status } satisfies PortOutbound);

  // Connect eagerly when the first tab attaches: one cheap socket per origin,
  // so `open` is the baseline and the degraded banner reflects a real failure
  // rather than the absence of a subscription (e.g. on the maps-list page).
  connect();
});
