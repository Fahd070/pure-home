// TEMPORARY, standalone database-latency benchmark.
//
// This is NOT a second Pure Home backend. It does not import anything from
// packages/backend/src, has no routes, no auth, no Socket.IO, no cron/timers,
// no migrations, no seed logic, and issues exactly one kind of database
// operation across its entire lifetime: a read-only `SELECT 1` on GET /health.
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

app.get('/', (_req, res) => {
  res.type('text/plain').send(
    'Pure Home DB latency benchmark (temporary, read-only, no application logic). See GET /health.'
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

const PORT = parseInt(process.env.PORT || '3001', 10);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`db-latency-benchmark listening on port ${PORT}`);
});
