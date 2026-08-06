-- Brings under Prisma migration control every remaining schema.prisma-declared object
-- confirmed (via read-only production metadata, 2026-08-07) to already exist in
-- production but never captured in a migration: system_configs (raw-SQL startup only),
-- and a set of columns/tables with no tracked creation source anywhere in the repo
-- (most likely applied to production directly at some point, outside any tracked
-- process). Column types/defaults/nullability below were verified to match production
-- exactly. All statements are idempotent.

-- system_configs: also created by index.ts's ensureSystemConfigTable() at runtime,
-- never by a migration. Access codes and other key/value config live here.
CREATE TABLE IF NOT EXISTS "system_configs" (
    "id"        TEXT NOT NULL,
    "key"       TEXT NOT NULL,
    "value"     TEXT NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "system_configs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "system_configs_key_key" ON "system_configs"("key");

-- audit_logs: before/after snapshot columns used by writeAudit(), plus their indexes.
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "beforeState" JSONB;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "afterState" JSONB;
CREATE INDEX IF NOT EXISTS "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "audit_logs_userId_idx" ON "audit_logs"("userId");
CREATE INDEX IF NOT EXISTS "audit_logs_createdAt_idx" ON "audit_logs"("createdAt" DESC);

-- call_reports: unregistered-caller support + nullable customer link (also raw-SQL
-- startup only). FK re-added DEFERRABLE INITIALLY DEFERRED, matching production and
-- the runtime helper -- Prisma's schema language has no attribute for this, so it is
-- expressed here in plain SQL only.
ALTER TABLE "call_reports" ALTER COLUMN "customerId" DROP NOT NULL;
ALTER TABLE "call_reports" ADD COLUMN IF NOT EXISTS "unregisteredName" TEXT;
ALTER TABLE "call_reports" ADD COLUMN IF NOT EXISTS "unregisteredPhone" TEXT;
ALTER TABLE "call_reports" DROP CONSTRAINT IF EXISTS "call_reports_customerId_fkey";
ALTER TABLE "call_reports" ADD CONSTRAINT "call_reports_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- customers: dismissible-activity-feed flag (no tracked creation source found anywhere).
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "activityDismissed" BOOLEAN NOT NULL DEFAULT false;

-- expenses: invoice-generation flag (raw-SQL startup only).
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "invoiceGenerated" BOOLEAN NOT NULL DEFAULT false;

-- event_logs: no tracked creation source found anywhere; modeled in schema.prisma and
-- actively used by event.service.ts.
CREATE TABLE IF NOT EXISTS "event_logs" (
    "id"         TEXT NOT NULL,
    "eventType"  TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId"   TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "payload"    JSONB NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "event_logs_eventType_idx" ON "event_logs"("eventType");
CREATE INDEX IF NOT EXISTS "event_logs_entityType_entityId_idx" ON "event_logs"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "event_logs_createdAt_idx" ON "event_logs"("createdAt" DESC);

-- direct_messages: no tracked creation source found anywhere; modeled in schema.prisma
-- and actively used by the Direct Messages feature.
CREATE TABLE IF NOT EXISTS "direct_messages" (
    "id"            TEXT NOT NULL,
    "content"       TEXT NOT NULL,
    "senderId"      TEXT NOT NULL,
    "recipientRole" TEXT NOT NULL,
    "isRead"        BOOLEAN NOT NULL DEFAULT false,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "direct_messages_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'direct_messages_senderId_fkey') THEN
    ALTER TABLE "direct_messages"
      ADD CONSTRAINT "direct_messages_senderId_fkey"
      FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- NOTE (deliberately not touched here -- see final report section E/M):
-- "customer_approval_requests" (unused, unmodeled) and the leftover "WorkStatus" enum
-- type (unused, workStatus is stored as TEXT) both still exist in production. Neither
-- is created here; the backend startup helpers that used to (re)create them are being
-- removed, not replaced, since nothing reads or writes them.
