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

async function ensureSchemaUpdates() {
  const run = async (sql: string) => {
    try { await prisma.$executeRawUnsafe(sql); } catch {}
  };
  try {
    // customers: installationDate
    await run(`ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "installationDate" TIMESTAMP(3)`);
    // appointments: new columns & nullable customerId
    await run(`ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "isUrgent" BOOLEAN NOT NULL DEFAULT false`);
    await run(`ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "adminApproved" BOOLEAN NOT NULL DEFAULT false`);
    await run(`ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "visibleToScheduling" BOOLEAN NOT NULL DEFAULT true`);
    await run(`ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "createdByRole" TEXT`);
    await run(`ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "createdById" TEXT`);
    await run(`ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "urgentLocation" TEXT`);
    await run(`ALTER TABLE "appointments" ALTER COLUMN "customerId" DROP NOT NULL`);
    await run(`ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_customerId_fkey"`);
    await run(`ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE`);
    // maintenance_tasks: completion fields
    await run(`ALTER TABLE "maintenance_tasks" ADD COLUMN IF NOT EXISTS "serviceDetails" TEXT`);
    await run(`ALTER TABLE "maintenance_tasks" ADD COLUMN IF NOT EXISTS "completionAmount" DOUBLE PRECISION`);
    await run(`ALTER TABLE "maintenance_tasks" ADD COLUMN IF NOT EXISTS "completionPaymentMethod" TEXT`);
    // call_reports table
    await run(`CREATE TABLE IF NOT EXISTS "call_reports" ("id" TEXT NOT NULL,"customerId" TEXT NOT NULL,"employeeName" TEXT NOT NULL,"callDate" TIMESTAMP(3) NOT NULL,"notes" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"createdById" TEXT,CONSTRAINT "call_reports_pkey" PRIMARY KEY ("id"))`);
    await run(`ALTER TABLE "call_reports" ADD CONSTRAINT "call_reports_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
    await run(`ALTER TABLE "call_reports" ADD CONSTRAINT "call_reports_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE`);
    // expenses table
    await run(`CREATE TABLE IF NOT EXISTS "expenses" ("id" TEXT NOT NULL,"amount" DOUBLE PRECISION NOT NULL,"category" TEXT NOT NULL,"description" TEXT,"date" TIMESTAMP(3) NOT NULL,"receiptImage" TEXT,"status" TEXT NOT NULL DEFAULT 'PENDING',"technicianId" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "expenses_pkey" PRIMARY KEY ("id"))`);
    await run(`ALTER TABLE "expenses" ADD CONSTRAINT "expenses_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE`);
    // urgent_visit_records table
    await run(`CREATE TABLE IF NOT EXISTS "urgent_visit_records" ("id" TEXT NOT NULL,"appointmentId" TEXT NOT NULL,"customerInfo" TEXT,"serviceDetails" TEXT,"notes" TEXT,"paymentMethod" TEXT NOT NULL,"submittedById" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "urgent_visit_records_pkey" PRIMARY KEY ("id"),CONSTRAINT "urgent_visit_records_appointmentId_key" UNIQUE ("appointmentId"))`);
    await run(`ALTER TABLE "urgent_visit_records" ADD CONSTRAINT "urgent_visit_records_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
    await run(`ALTER TABLE "urgent_visit_records" ADD CONSTRAINT "urgent_visit_records_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE`);
    await run(`ALTER TABLE "urgent_visit_records" ADD COLUMN IF NOT EXISTS "customerName" TEXT`);
    await run(`ALTER TABLE "urgent_visit_records" ADD COLUMN IF NOT EXISTS "customerPhone" TEXT`);
    await run(`ALTER TABLE "urgent_visit_records" ADD COLUMN IF NOT EXISTS "customerDetails" TEXT`);
    await run(`ALTER TABLE "urgent_visit_records" ADD COLUMN IF NOT EXISTS "serviceNotes" TEXT`);
    await run(`ALTER TABLE "urgent_visit_records" ADD COLUMN IF NOT EXISTS "serviceType" TEXT`);
    await run(`ALTER TABLE "urgent_visit_records" ADD COLUMN IF NOT EXISTS "amount" DOUBLE PRECISION`);
    // expenses: invoiceGenerated flag
    await run(`ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "invoiceGenerated" BOOLEAN NOT NULL DEFAULT false`);
    // user_settings color columns
    await run(`ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "primaryColor" TEXT`);
    await run(`ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "secondaryColor" TEXT`);
    await run(`ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "buttonColor" TEXT`);
    await run(`ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "cardColor" TEXT`);
    console.log('  schema updates:  applied');
  } catch (e: any) {
    console.error('  schema updates:  warning —', e?.message || e);
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
ensureSchemaUpdates();
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
