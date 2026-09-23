import { describe, it, expect } from 'vitest';
import { clientIp } from '../cspLimiter';
import { handleAiEndpoint } from '../handlers';

describe('EA-12 hardening', () => {
  it('rate-limit identity is the address nginx saw, not a client-supplied first hop', () => {
    expect(clientIp({ headers: { 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4' } })).toBe('203.0.113.7');
    expect(clientIp({ headers: { 'x-forwarded-for': 'spoofed, 203.0.113.7' } })).toBe('203.0.113.7');
    expect(clientIp({ headers: {}, socket: { remoteAddress: '127.0.0.1' } })).toBe('127.0.0.1');
  });

  it('inherited object members are not AI endpoints', async () => {
    for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      const res = await handleAiEndpoint(name, 'u1', {});
      expect(res.status).toBe(404);
    }
  });
});
