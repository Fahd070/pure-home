-- Brings under Prisma migration control the "remove standalone tasks system, migrate
-- work management to appointments" change plus the optimistic-concurrency "version"
-- columns. Both were historically applied ONLY by the backend's runtime startup code
-- (packages/backend/src/index.ts -> ensureSchemaUpdates()), never by a migration.
-- Verified via read-only production metadata (2026-08-07): maintenance_tasks,
-- task_history, and the TaskStatus enum no longer exist in production, and
-- postponement_records.taskId is already gone -- this migration's DROP statements are
-- therefore safe no-ops there. All statements are idempotent so this is also correct
-- to run against a completely fresh database, where migration 20260605221150_init has
-- just created maintenance_tasks/task_history and this migration must backfill from
-- them before dropping them.

-- Optimistic-concurrency version columns (declared in schema.prisma).
ALTER TABLE "customers"    ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

-- Work-management columns added to appointments when the standalone tasks system was
-- removed (workStatus is TEXT, not the leftover unused WorkStatus enum type).
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "technicianId" TEXT;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "workStatus" TEXT NOT NULL DEFAULT 'WAITING';
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "workNotes" TEXT;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "serviceDetails" TEXT;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "completionAmount" DOUBLE PRECISION;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "completionPaymentMethod" TEXT;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "completionImage" TEXT;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3);
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_technicianId_fkey') THEN
    ALTER TABLE "appointments"
      ADD CONSTRAINT "appointments_technicianId_fkey"
      FOREIGN KEY ("technicianId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- postponement_records: re-point from tasks to appointments
ALTER TABLE "postponement_records" ADD COLUMN IF NOT EXISTS "appointmentId" TEXT;

-- Backfill from maintenance_tasks/task_history only if those tables still exist
-- (a fresh database created after this migration never has them; verified production
-- no longer has them either, so this block is a no-op there).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'maintenance_tasks') THEN
    ALTER TABLE "maintenance_tasks" ADD COLUMN IF NOT EXISTS "completionImage" TEXT;

    UPDATE "appointments" a SET
      "technicianId" = t."technicianId",
      "workStatus" = CASE
        WHEN t.status IN ('PENDING_APPROVAL','APPROVED') THEN 'WAITING'
        WHEN t.status = 'IN_PROGRESS' THEN 'IN_PROGRESS'
        WHEN t.status = 'COMPLETED' THEN 'COMPLETED'
        WHEN t.status = 'POSTPONED' THEN 'POSTPONED'
        ELSE 'WAITING'
      END,
      "workNotes" = t.notes,
      "serviceDetails" = t."serviceDetails",
      "completionAmount" = t."completionAmount",
      "completionPaymentMethod" = t."completionPaymentMethod",
      "completionImage" = t."completionImage",
      "startedAt" = t."startedAt",
      "completedAt" = t."completedAt"
    FROM "maintenance_tasks" t
    WHERE t."appointmentId" = a.id;

    UPDATE "postponement_records" pr
    SET "appointmentId" = mt."appointmentId"
    FROM "maintenance_tasks" mt
    WHERE pr."taskId" = mt.id;
  END IF;
END $$;

ALTER TABLE "postponement_records" DROP CONSTRAINT IF EXISTS "postponement_records_taskId_fkey";
ALTER TABLE "postponement_records" DROP COLUMN IF EXISTS "taskId";

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'postponement_records_appointmentId_fkey') THEN
    ALTER TABLE "postponement_records"
      ADD CONSTRAINT "postponement_records_appointmentId_fkey"
      FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Drop the now-unused standalone tasks system (superseded by appointments.workStatus etc.)
-- Confirmed via production metadata: both tables already absent there.
DROP TABLE IF EXISTS "task_history" CASCADE;
DROP TABLE IF EXISTS "maintenance_tasks" CASCADE;
DROP TYPE IF EXISTS "TaskStatus";
