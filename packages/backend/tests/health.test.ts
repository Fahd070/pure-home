import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';

describe('Health / startup', () => {
  let ts: TestServer;

  beforeAll(async () => {
    ts = await startTestServer();
  });

  afterAll(async () => {
    await stopTestServer(ts.server);
  });

  it('GET /health returns 200 with a confirmed DB connection', async () => {
    const res = await request(ts.baseUrl).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('connected');
    expect(typeof res.body.dbResponseMs).toBe('number');
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });
});
