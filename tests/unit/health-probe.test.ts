// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const busState = { connected: false, subscribers: 0, instanceListeners: 0 };

vi.mock('@/lib/realtime/bus', () => ({
  bus: {
    isHealthy: () => busState.connected,
    subscriberCount: () => busState.subscribers,
    instanceListenerCount: () => busState.instanceListeners,
  },
}));
vi.mock('@/db/client', () => ({
  pool: { query: vi.fn(async () => ({ rows: [{ last_created: String(Number.MAX_SAFE_INTEGER) }] })) },
}));
vi.mock('@/lib/jobs/queries', () => ({
  latestFinishedRun: vi.fn(async () => ({ name: 'locationPoll', endedAt: new Date() })),
}));
vi.mock('@/lib/esi/breaker', () => ({ openBreakerCount: () => 0 }));

const { deepHealth } = await import('@/lib/health/probe');

async function realtimeBusStatus(): Promise<string> {
  return (await deepHealth()).components.realtimeBus.status;
}

describe('deepHealth realtimeBus', () => {
  beforeEach(() => {
    Object.assign(busState, { connected: false, subscribers: 0, instanceListeners: 0 });
  });

  it('is ok while the LISTEN connection is live', async () => {
    Object.assign(busState, { connected: true, subscribers: 3, instanceListeners: 1 });
    expect(await realtimeBusStatus()).toBe('ok');
  });

  it('is ok when nothing listens on a disconnected bus', async () => {
    expect(await realtimeBusStatus()).toBe('ok');
  });

  it('is degraded when map subscribers exist but the connection is down', async () => {
    busState.subscribers = 2;
    expect(await realtimeBusStatus()).toBe('degraded');
  });

  it('is degraded when only an instance listener exists and the connection is down', async () => {
    busState.instanceListeners = 1;
    expect(await realtimeBusStatus()).toBe('degraded');
  });
});
