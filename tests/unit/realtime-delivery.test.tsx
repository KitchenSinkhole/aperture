import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RealtimeProvider,
  useRealtimeEvents,
} from '@/lib/realtime/useRealtime';
import type { Envelope } from '@/lib/realtime/protocol';

// Fake SharedWorker port: the provider sets `onmessage` and calls `start()`;
// the test drives delivery by invoking `onmessage` directly. The most recently
// constructed port is captured so the test can fire frames at it.
class FakePort {
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  start = vi.fn();
  close = vi.fn();
}

let lastPort: FakePort | null = null;

class FakeSharedWorker {
  port: FakePort;
  constructor() {
    this.port = new FakePort();
    lastPort = this.port;
  }
}

function Probe({ onEnv }: { onEnv: (env: Envelope) => void }) {
  useRealtimeEvents(onEnv);
  return null;
}

function envelopeFrame(n: number) {
  // `envelopeSchema` only pins `{ task, load }`; `load` is `unknown`, so any
  // shape rides through — we tag each with `n` to assert delivery order.
  return { data: { type: 'message', envelope: { task: 'mapUpdate', load: { n } } } } as MessageEvent;
}

describe('realtime envelope delivery', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    vi.stubGlobal('SharedWorker', FakeSharedWorker);
    lastPort = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('delivers every envelope in a same-tick burst, in order', () => {
    const received: number[] = [];
    act(() => {
      root.render(
        <RealtimeProvider>
          <Probe onEnv={(env) => received.push((env.load as { n: number }).n)} />
        </RealtimeProvider>,
      );
    });

    expect(lastPort).not.toBeNull();
    const port = lastPort!;
    expect(port.onmessage).toBeTypeOf('function');

    // Fire N frames synchronously within one act() — no await between them, so
    // React has no chance to flush between deliveries. The old single-slot
    // `lastEvent` state coalesced these to one; the listener registry delivers
    // all N.
    const N = 5;
    act(() => {
      for (let i = 0; i < N; i++) port.onmessage!(envelopeFrame(i));
    });

    expect(received).toEqual([0, 1, 2, 3, 4]);
  });

  it('stops delivering after the consumer unmounts', () => {
    const received: number[] = [];
    act(() => {
      root.render(
        <RealtimeProvider>
          <Probe onEnv={(env) => received.push((env.load as { n: number }).n)} />
        </RealtimeProvider>,
      );
    });
    const port = lastPort!;

    act(() => port.onmessage!(envelopeFrame(0)));
    // Re-render without the Probe — its listener must be torn down.
    act(() => root.render(<RealtimeProvider>{null}</RealtimeProvider>));
    act(() => port.onmessage!(envelopeFrame(1)));

    expect(received).toEqual([0]);
  });
});

// Exercises `sharedWorker.ts` itself (not the client-side provider): a fake
// `self` captures the `connect` listener the module registers at import time,
// and a fake `WebSocket` stands in for the one socket the worker opens. Each
// test re-imports the module after `vi.resetModules()` so the worker's
// module-level `ports`/`subscriptions`/`socket` state starts fresh.
describe('sharedWorker per-port routing', () => {
  class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    // Constructed by sharedWorker.ts's own `connect()`, not by the test, so the
    // test recovers the instance from this static list rather than aliasing `this`.
    static instances: FakeWebSocket[] = [];
    readyState: number = FakeWebSocket.CONNECTING;
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    send = vi.fn();
    constructor() {
      FakeWebSocket.instances.push(this);
    }
  }

  class FakeSelf {
    listeners: Record<string, ((e: unknown) => void)[]> = {};
    location = { protocol: 'https:', host: 'test.invalid' };
    addEventListener(type: string, cb: (e: unknown) => void) {
      (this.listeners[type] ??= []).push(cb);
    }
    dispatchConnect(port: FakePort) {
      for (const cb of this.listeners.connect ?? []) cb({ ports: [port] });
    }
  }

  type PortOutboundMessage = { type: 'message'; envelope: { task: string; mapId?: number } };

  let fakeSelf: FakeSelf;

  beforeEach(async () => {
    vi.resetModules();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    fakeSelf = new FakeSelf();
    vi.stubGlobal('self', fakeSelf);
    await import('@/lib/realtime/sharedWorker');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function messagesOf(port: FakePort): PortOutboundMessage[] {
    return port.postMessage.mock.calls
      .map(([msg]) => msg as { type: string })
      .filter((msg): msg is PortOutboundMessage => msg.type === 'message');
  }

  function connectTwoSubscribedPorts(): { portA: FakePort; portB: FakePort; socket: FakeWebSocket } {
    const portA = new FakePort();
    const portB = new FakePort();
    fakeSelf.dispatchConnect(portA);
    fakeSelf.dispatchConnect(portB);
    portA.onmessage!({ data: { type: 'subscribe', mapId: 1 } } as MessageEvent);
    portB.onmessage!({ data: { type: 'subscribe', mapId: 2 } } as MessageEvent);
    expect(FakeWebSocket.instances).toHaveLength(1);
    const socket = FakeWebSocket.instances[0]!;
    socket.readyState = FakeWebSocket.OPEN;
    socket.onopen!();
    return { portA, portB, socket };
  }

  it('routes a mapId-tagged envelope only to the matching subscriber', () => {
    const { portA, portB, socket } = connectTwoSubscribedPorts();

    socket.onmessage!({
      data: JSON.stringify({ task: 'characterUpdate', mapId: 1, load: { n: 1 } }),
    });

    const receivedByA = messagesOf(portA);
    expect(receivedByA).toHaveLength(1);
    expect(receivedByA[0]!.envelope).toMatchObject({ task: 'characterUpdate', mapId: 1 });
    expect(messagesOf(portB)).toHaveLength(0);
  });

  it('fans a control-plane frame (no mapId) out to every port', () => {
    const { portA, portB, socket } = connectTwoSubscribedPorts();

    socket.onmessage!({ data: JSON.stringify({ task: 'healthCheck', load: { ts: 1 } }) });

    const receivedByA = messagesOf(portA);
    const receivedByB = messagesOf(portB);
    expect(receivedByA).toHaveLength(1);
    expect(receivedByB).toHaveLength(1);
    expect(receivedByA[0]!.envelope.task).toBe('healthCheck');
    expect(receivedByB[0]!.envelope.task).toBe('healthCheck');
  });
});
