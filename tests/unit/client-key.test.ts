// @vitest-environment node
import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  CLIENT_IP_HEADER,
  clientIpOfNodeRequest,
  clientIpOfRequest,
  resolveClientIp,
} from '@/lib/http/clientKey';

const SOCKET = '10.0.0.2';

function resolve(forwardedFor: string | null, hops: number, realIp: string | null = null): string {
  return resolveClientIp({ forwardedFor, realIp, socketAddress: SOCKET }, hops);
}

describe('resolveClientIp', () => {
  it('uses the socket peer with no trusted proxy, whatever the headers say', () => {
    expect(resolve('203.0.113.9', 0, '203.0.113.8')).toBe(SOCKET);
  });

  it('takes the entry the trusted proxies appended, not the ones the client wrote', () => {
    expect(resolve('198.51.100.1', 1)).toBe('198.51.100.1');
    expect(resolve('6.6.6.6, 198.51.100.1', 1)).toBe('198.51.100.1');
    expect(resolve('6.6.6.6, 198.51.100.1, 172.16.0.5', 2)).toBe('198.51.100.1');
    expect(resolve(' 6.6.6.6 ,198.51.100.1 ,', 1)).toBe('198.51.100.1');
  });

  it('takes the right-most entry when entries run short, ignoring X-Real-IP the client could write', () => {
    expect(resolve('198.51.100.1', 2, '6.6.6.6')).toBe('198.51.100.1');
    expect(resolve('198.51.100.1', 2)).toBe('198.51.100.1');
    expect(resolve('6.6.6.6, 198.51.100.1', 3, '6.6.6.7')).toBe('198.51.100.1');
  });

  it('falls back to X-Real-IP only without X-Forwarded-For, then the socket', () => {
    expect(resolve(null, 1, '198.51.100.7')).toBe('198.51.100.7');
    expect(resolve(' , ', 2, '198.51.100.7')).toBe('198.51.100.7');
    expect(resolve(null, 1)).toBe(SOCKET);
    expect(resolveClientIp({ forwardedFor: null, realIp: null, socketAddress: undefined }, 1)).toBe(
      'unknown',
    );
  });
});

describe('clientIpOfNodeRequest', () => {
  it('joins repeated X-Forwarded-For headers in order and reads the socket peer', () => {
    const req = {
      headers: { 'x-forwarded-for': ['6.6.6.6', '198.51.100.1'] },
      socket: { remoteAddress: SOCKET },
    } as unknown as IncomingMessage;
    expect(clientIpOfNodeRequest(req, 1)).toBe('198.51.100.1');
    expect(clientIpOfNodeRequest(req, 0)).toBe(SOCKET);
  });
});

describe('clientIpOfRequest', () => {
  it('reads the address server.ts stamped, else unknown', () => {
    expect(clientIpOfRequest(new Headers({ [CLIENT_IP_HEADER]: '198.51.100.1' }))).toBe(
      '198.51.100.1',
    );
    expect(clientIpOfRequest(new Headers({ 'x-forwarded-for': '6.6.6.6' }))).toBe('unknown');
  });
});
