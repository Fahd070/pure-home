import 'dotenv/config';
import http from 'http';
import os from 'os';
import app from './app';
import { initSocket } from './socket';
import { startNotificationCron } from './services/notification.service';
import prisma from './prisma';

// Schema is now managed exclusively through Prisma migrations
// (packages/backend/prisma/migrations/) -- startup no longer runs any
// CREATE/ALTER/DROP. This performs a read-only check that the tables migrations are
// expected to have created are actually present, logging a clear diagnostic (not
// throwing) if not, since production does not yet run `prisma migrate deploy`
// automatically as part of deployment. See docs/DEPLOY-RENDER.md for the required
// one-time production migration step.
async function verifySchemaIsMigrated() {
  const expectedTables = ['users', 'system_configs', 'user_settings', 'event_logs', 'direct_messages'];
  try {
    const rows = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
      expectedTables
    );
    const present = new Set(rows.map((r) => r.table_name));
    const missing = expectedTables.filter((t) => !present.has(t));
    if (missing.length > 0) {
      console.error(
        `  schema check:    MISSING TABLES: ${missing.join(', ')} -- run "npx prisma migrate deploy" ` +
        `(or, if this is production's very first migration run, baseline it first per docs/DEPLOY-RENDER.md) ` +
        `before serving traffic.`
      );
    } else {
      console.log('  schema check:    ok (all expected tables present)');
    }
  } catch (e: any) {
    console.error('  schema check:    could not verify —', e?.message || e);
  }
}

// Safety net for errors that escape Express's own request-scoped try/catch +
// errorHandler (e.g. an unawaited promise in a cron job or socket handler).
// Deliberately logs only and never calls process.exit(): Render owns this
// process's lifecycle (restarts, health checks) -- forcing an exit here would
// fight that rather than let a single unexpected error take down the whole
// service for the other five employees mid-request.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

const PORT = parseInt(process.env.PORT || '3001');
const BIND_HOST = process.env.BIND_HOST || '0.0.0.0';

const server = http.createServer(app);
initSocket(server);
startNotificationCron();
verifySchemaIsMigrated();
server.listen(PORT, BIND_HOST, () => {
  const onRender = !!process.env.RENDER;

  console.log('');
  console.log('  Pure Home Backend started');

  if (onRender) {
    const serviceUrl = process.env.RENDER_EXTERNAL_URL || `https://wfm-system.onrender.com`;
    console.log(`  Render:     ${serviceUrl}`);
  } else {
    // Local / on-premise: detect Tailscale and LAN addresses for the startup banner
    let tailscaleIP = '';
    let lanIP = '';
    for (const [name, nets] of Object.entries(os.networkInterfaces())) {
      for (const net of nets || []) {
        if (net.family !== 'IPv4' || net.internal) continue;
        const parts = net.address.split('.').map(Number);
        if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) {
          tailscaleIP = net.address;
        } else if (!lanIP && name.toLowerCase() !== 'loopback') {
          lanIP = net.address;
        }
      }
    }

    console.log(`  Local:      http://127.0.0.1:${PORT}`);
    if (tailscaleIP) {
      console.log(`  Tailscale:  http://${tailscaleIP}:${PORT}  <- use this URL on all employee PCs`);
    }
    if (lanIP && lanIP !== tailscaleIP) {
      console.log(`  LAN:        http://${lanIP}:${PORT}`);
    }
    if (!tailscaleIP) {
      console.log(`  WARNING: Tailscale IP not detected. Run: tailscale up`);
    }
  }

  console.log('');
});
