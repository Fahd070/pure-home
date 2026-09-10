-- v4.0.0 Phase 1: core domain + technician identity.
--
-- Every statement below is ADDITIVE. No column is dropped, renamed, retyped or
-- made NOT NULL; no enum is altered; no existing row is rewritten. Deployed
-- against production this adds four nullable columns, one defaulted column, two
-- empty tables, one index and one unique constraint, and changes no existing
-- data. That is deliberate: employees stay on Desktop v3.6.5 throughout this
-- development cycle and must keep running unmodified against this schema.
--
-- DELIBERATELY OMITTED: `ALTER TABLE "system_configs" ALTER COLUMN "updatedAt"
-- DROP DEFAULT;`. `prisma migrate diff` emits that statement, but it is
-- PRE-EXISTING drift between the migration chain and schema.prisma that is
-- present on clean main and has nothing to do with this migration (verified by
-- re-running the diff with this branch's schema changes stashed). Bundling an
-- unrelated production DDL change into an identity/domain migration would make
-- this migration's blast radius larger than its description. It is left for a
-- separate, deliberate change.
--
-- Nothing here backfills data. `customers.nextMaintenanceDueAt` is populated by
-- scripts/backfill-next-maintenance-due.ts AFTER deploy, which reuses the same
-- domain service the application uses, so the date math has exactly one
-- implementation rather than a second copy written in SQL.

-- Per-technician access code (bcrypt hash of the code, using the same hashing
-- as users.password). Nullable: existing users have no code, and a technician
-- without one falls back to the legacy shared department code, which is what
-- keeps v3.6.5 clients working during the transition.
--
-- Also carries sessionVersion. This migration is AMENDED rather than followed by
-- a second one because it has never been committed, deployed or applied to any
-- non-disposable database -- so there is no history for a follow-up migration to
-- preserve, and one additive migration keeps the production deployment to a
-- single gated run with a single rollback point.
-- `sessionVersion` (v4 decision D9) is defaulted and NOT NULL, which is safe on a
-- populated table: PostgreSQL backfills every existing row with 1 as part of the
-- ALTER, and since PG11 that is a metadata-only operation for a constant default
-- (no table rewrite). Every pre-existing user therefore lands on version 1, which
-- is exactly what freshly-issued tokens will carry.
ALTER TABLE "users" ADD COLUMN     "accessCodeHash" TEXT,
ADD COLUMN     "accessCodeSetAt" TIMESTAMP(3),
ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 1;

-- Materialized next-maintenance due date. Nullable, and NULL is meaningful:
-- "no baseline exists to derive a due date from". Never a fabricated date.
ALTER TABLE "customers" ADD COLUMN     "nextMaintenanceDueAt" TIMESTAMP(3);

-- The scheduledDate an appointment held immediately before a postponement moved
-- it. Nullable so pre-existing postponement rows stay valid and simply have no
-- captured previous date.
ALTER TABLE "postponement_records" ADD COLUMN     "previousDate" TIMESTAMP(3);

-- Minimum notification foundation for Phase 2. `severity` is defaulted, so every
-- existing notification becomes 'INFO', which is the correct classification for
-- the appointment reminders that are currently the only rows in this table.
ALTER TABLE "notifications" ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "entityId" TEXT,
ADD COLUMN     "entityType" TEXT,
ADD COLUMN     "severity" TEXT NOT NULL DEFAULT 'INFO';

-- Optional branch detail records under ONE customer. Never additional customers.
CREATE TABLE "customer_branches" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "branchName" TEXT NOT NULL,
    "supervisorName" TEXT,
    "supervisorMobile" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_branches_pkey" PRIMARY KEY ("id")
);

-- Durable "customer did not answer" attempts. One row per attempt, so repeated
-- failed contacts on the same appointment all survive.
CREATE TABLE "customer_no_answer_records" (
    "id" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appointmentId" TEXT,
    "recordedById" TEXT,

    CONSTRAINT "customer_no_answer_records_pkey" PRIMARY KEY ("id")
);

-- The only access pattern this table has, and what keeps the cascade below an
-- indexed delete rather than a sequential scan on every customer deletion.
CREATE INDEX "customer_branches_customerId_idx" ON "customer_branches"("customerId");

-- Deduplication as a database guarantee rather than a racy read-then-write.
-- Safe to add to the populated production table precisely because every existing
-- row has dedupeKey = NULL, and PostgreSQL permits unlimited NULLs in a unique
-- index -- so this constraint cannot fail on existing data.
CREATE UNIQUE INDEX "notifications_userId_dedupeKey_key" ON "notifications"("userId", "dedupeKey");

ALTER TABLE "customer_branches" ADD CONSTRAINT "customer_branches_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_no_answer_records" ADD CONSTRAINT "customer_no_answer_records_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL, not CASCADE: a did-not-answer attempt is operational history that
-- must survive the deletion of the user account that recorded it, exactly as
-- PostponementRecord.requestedById already does.
ALTER TABLE "customer_no_answer_records" ADD CONSTRAINT "customer_no_answer_records_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
