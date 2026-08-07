import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';

// Permanent regression tests for audit finding F-6: Express `trust proxy` must be
// set to exactly 1 hop to match Render's own single reverse-proxy topology
// (Render's load balancer terminates TLS and forwards over HTTP through one hop --
// see docs/DEPLOY-RENDER.md). These prove express-rate-limit's per-IP buckets
// resolve the real client IP correctly, and cannot be spoofed via extra,
// attacker-supplied X-Forwarded-For entries beyond the one trusted hop.
describe('trust proxy / rate-limit client IP resolution (F-6)', () => {
  let ts: TestServer;

  beforeAll(async () => { ts = await startTestServer(); });
  afterAll(async () => { await stopTestServer(ts.server); });

  async function hit(xff?: string): Promise<{ remaining: number; limit: number }> {
    const req_ = xff
      ? request(ts.baseUrl).get('/health').set('X-Forwarded-For', xff)
      : request(ts.baseUrl).get('/health');
    const res = await req_;
    expect(res.status).toBe(200);
    return {
      remaining: Number(res.headers['x-ratelimit-remaining']),
      limit: Number(res.headers['x-ratelimit-limit']),
    };
  }

  it('a direct/unproxied request (no X-Forwarded-For) behaves safely and gets its own bucket', async () => {
    const first = await hit();
    const second = await hit();
    expect(second.remaining).toBe(first.remaining - 1);
  });

  it('a single X-Forwarded-For entry behind the trusted hop resolves as the client IP', async () => {
    const first = await hit('203.0.113.10');
    const second = await hit('203.0.113.10');
    expect(second.remaining).toBe(first.remaining - 1);
  });

  it('with trust proxy=1, only the right-most X-Forwarded-For entry is trusted -- a spoofed left-most entry is ignored', async () => {
    const seeded = await hit('203.0.113.20');
    // Attacker-prefixed chain, but the real (right-most) client is unchanged.
    const viaSpoofedChain = await hit('198.51.100.99, 203.0.113.20');
    expect(viaSpoofedChain.remaining).toBe(seeded.remaining - 1);

    // The spoofed left-most address must not have been credited as its own client
    // identity -- using it alone now must still be a fresh, untouched bucket.
    const spoofedAlone = await hit('198.51.100.99');
    expect(spoofedAlone.remaining).toBe(spoofedAlone.limit - 1);
  });

  it('a long crafted X-Forwarded-For chain cannot cause more than the configured 1 hop to be trusted', async () => {
    const seeded = await hit('203.0.113.30');
    const longChain = await hit('1.1.1.1, 2.2.2.2, 3.3.3.3, 4.4.4.4, 203.0.113.30');
    expect(longChain.remaining).toBe(seeded.remaining - 1);
  });

  it('two different simulated client IPs are tracked in independent buckets, not collapsed together', async () => {
    const a1 = await hit('203.0.113.40');
    const b1 = await hit('203.0.113.41');
    // Both are first-time IPs -> both start at the same fresh ceiling, proving they
    // are NOT sharing a single collapsed bucket (which would show b1 < a1).
    expect(a1.remaining).toBe(b1.remaining);
    const a2 = await hit('203.0.113.40');
    expect(a2.remaining).toBe(a1.remaining - 1); // only A's own bucket moved
  });

  it('rate limiting (authLimiter, real configured max=50, unchanged) still blocks after the threshold', async () => {
    let last: request.Response | undefined;
    for (let i = 0; i < 51; i++) {
      last = await request(ts.baseUrl).post('/api/auth/login').set('X-Forwarded-For', '203.0.113.99').send({});
    }
    expect(last!.status).toBe(429);
    expect(last!.body).toEqual({ success: false, message: 'Too many attempts, try again later' });
  }, 20000);

  it('a client IP not involved in the exhausted authLimiter bucket is unaffected', async () => {
    const res = await request(ts.baseUrl).post('/api/auth/login').set('X-Forwarded-For', '203.0.113.100').send({});
    expect(res.status).not.toBe(429);
  });

  it('does not log express-rate-limit\'s ERR_ERL_UNEXPECTED_X_FORWARDED_FOR / ERR_ERL_PERMISSIVE_TRUST_PROXY warnings', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await request(ts.baseUrl).get('/health').set('X-Forwarded-For', '203.0.113.200');
      const loggedTrustProxyWarning = errorSpy.mock.calls.some((args) =>
        args.some((a) => String(a?.code ?? a).includes('ERR_ERL_'))
      );
      expect(loggedTrustProxyWarning).toBe(false);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
