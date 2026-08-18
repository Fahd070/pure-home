// TEMPORARY, standalone database-latency benchmark.
//
// This is NOT a second Pure Home backend. It does not import anything from
// packages/backend/src, has no routes, no auth, no Socket.IO, no cron/timers,
// no migrations, no seed logic, and issues exactly one kind of database
// operation across its entire lifetime: a read-only `SELECT 1`, on
// GET /health (one query) and on GET /parallel / GET /sequential (eight
// queries each, run concurrently vs. in a loop, to compare the effect of
// Prisma's connection_limit on concurrent read-only queries).
//
// Purpose: measure production Supabase latency from a Render service running
// in a different region (Singapore) than the real production backend
// (Oregon), for direct comparison. Deployed as its own separate Render Web
// Service pointed at this branch/directory -- never merged into main, never
// replacing or modifying the real production service.

const express = require('express');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();

const CONCURRENT_QUERY_COUNT = 8;

// The one and only DB operation this whole tool ever performs, timed.
async function timedSelectOne() {
  const t0 = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  return Date.now() - t0;
}

app.get('/', (_req, res) => {
  res.type('text/plain').send(
    'Pure Home DB latency benchmark (temporary, read-only, no application logic). See GET /health, GET /parallel, GET /sequential.'
  );
});

app.get('/health', async (_req, res) => {
  const t0 = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      database: 'connected',
      dbResponseMs: Date.now() - t0,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    res.status(503).json({
      status: 'degraded',
      database: 'disconnected',
      error: process.env.NODE_ENV === 'production' ? 'DB unreachable' : String((e && e.message) || e),
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  }
});

// 8 concurrent `SELECT 1`s via Promise.all -- measures how connection_limit
// affects queries that are fired at the database all at once.
app.get('/parallel', async (_req, res) => {
  const t0 = Date.now();
  try {
    const queriesMs = await Promise.all(
      Array.from({ length: CONCURRENT_QUERY_COUNT }, () => timedSelectOne())
    );
    res.json({
      status: 'ok',
      mode: 'parallel',
      queryCount: CONCURRENT_QUERY_COUNT,
      totalMs: Date.now() - t0,
      queriesMs,
    });
  } catch (e) {
    res.status(503).json({
      status: 'degraded',
      mode: 'parallel',
      error: process.env.NODE_ENV === 'production' ? 'DB unreachable' : String((e && e.message) || e),
    });
  }
});

// The same 8 `SELECT 1`s, but awaited one at a time in a loop -- the
// connection_limit-agnostic baseline to compare /parallel against.
app.get('/sequential', async (_req, res) => {
  const t0 = Date.now();
  const queriesMs = [];
  try {
    for (let i = 0; i < CONCURRENT_QUERY_COUNT; i++) {
      queriesMs.push(await timedSelectOne());
    }
    res.json({
      status: 'ok',
      mode: 'sequential',
      queryCount: CONCURRENT_QUERY_COUNT,
      totalMs: Date.now() - t0,
      queriesMs,
    });
  } catch (e) {
    res.status(503).json({
      status: 'degraded',
      mode: 'sequential',
      error: process.env.NODE_ENV === 'production' ? 'DB unreachable' : String((e && e.message) || e),
    });
  }
});

const PORT = parseInt(process.env.PORT || '3001', 10);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`db-latency-benchmark listening on port ${PORT}`);
});
