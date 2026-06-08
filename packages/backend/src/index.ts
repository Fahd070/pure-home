import 'dotenv/config';
import http from 'http';
import os from 'os';
import app from './app';
import { initSocket } from './socket';
import { startNotificationCron } from './services/notification.service';
import prisma from './prisma';

async function ensureUserSettingsTable() {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "user_settings" (
        "id"                   TEXT         NOT NULL,
        "userId"               TEXT         NOT NULL,
        "theme"                TEXT         NOT NULL DEFAULT 'light',
        "fontSize"             TEXT         NOT NULL DEFAULT 'medium',
        "interfaceScale"       TEXT         NOT NULL DEFAULT 'normal',
        "background"           TEXT         NOT NULL DEFAULT 'day',
        "highContrast"         BOOLEAN      NOT NULL DEFAULT false,
        "improvedReadability"  BOOLEAN      NOT NULL DEFAULT false,
        "notificationsEnabled" BOOLEAN      NOT NULL DEFAULT true,
        "soundEnabled"         BOOLEAN      NOT NULL DEFAULT true,
        "soundVolume"          INTEGER      NOT NULL DEFAULT 70,
        "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "user_settings_userId_key" ON "user_settings"("userId")`
    );
    console.log('  user_settings:   ready');
  } catch (e: any) {
    console.error('  user_settings:   setup warning —', e?.message || e);
  }
}

async function ensureSystemConfigTable() {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "system_configs" (
        "id"        TEXT        NOT NULL,
        "key"       TEXT        NOT NULL,
        "value"     TEXT        NOT NULL,
        "updatedBy" TEXT,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "system_configs_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "system_configs_key_key" ON "system_configs"("key")`
    );
    console.log('  system_configs: ready');
  } catch (e: any) {
    console.error('  system_configs: setup warning —', e?.message || e);
  }
}

const PORT = parseInt(process.env.PORT || '3001');
const BIND_HOST = process.env.BIND_HOST || '0.0.0.0';

const server = http.createServer(app);
initSocket(server);
startNotificationCron();
ensureSystemConfigTable();
ensureUserSettingsTable();
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
