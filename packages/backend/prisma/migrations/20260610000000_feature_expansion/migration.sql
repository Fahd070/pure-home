-- Feature Expansion Migration
-- Safe: all new columns have defaults or are nullable

-- 1. customers: add installationDate
ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "installationDate" TIMESTAMP(3);

-- 2. appointments: add urgent/approval workflow fields
ALTER TABLE "appointments"
  ADD COLUMN IF NOT EXISTS "isUrgent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "adminApproved" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "visibleToScheduling" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "createdByRole" TEXT;

-- 3. call_reports table
CREATE TABLE IF NOT EXISTS "call_reports" (
  "id"           TEXT         NOT NULL,
  "customerId"   TEXT         NOT NULL,
  "employeeName" TEXT         NOT NULL,
  "callDate"     TIMESTAMP(3) NOT NULL,
  "notes"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById"  TEXT,
  CONSTRAINT "call_reports_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'call_reports_customerId_fkey') THEN
    ALTER TABLE "call_reports"
      ADD CONSTRAINT "call_reports_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'call_reports_createdById_fkey') THEN
    ALTER TABLE "call_reports"
      ADD CONSTRAINT "call_reports_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 4. expenses table
CREATE TABLE IF NOT EXISTS "expenses" (
  "id"           TEXT             NOT NULL,
  "amount"       DOUBLE PRECISION NOT NULL,
  "category"     TEXT             NOT NULL,
  "description"  TEXT,
  "date"         TIMESTAMP(3)     NOT NULL,
  "receiptImage" TEXT,
  "status"       TEXT             NOT NULL DEFAULT 'PENDING',
  "technicianId" TEXT             NOT NULL,
  "createdAt"    TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_technicianId_fkey') THEN
    ALTER TABLE "expenses"
      ADD CONSTRAINT "expenses_technicianId_fkey"
      FOREIGN KEY ("technicianId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 5. urgent_visit_records table
CREATE TABLE IF NOT EXISTS "urgent_visit_records" (
  "id"             TEXT         NOT NULL,
  "appointmentId"  TEXT         NOT NULL,
  "customerInfo"   TEXT,
  "serviceDetails" TEXT,
  "notes"          TEXT,
  "paymentMethod"  TEXT         NOT NULL,
  "submittedById"  TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "urgent_visit_records_pkey"          PRIMARY KEY ("id"),
  CONSTRAINT "urgent_visit_records_appointmentId_key" UNIQUE ("appointmentId")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'urgent_visit_records_appointmentId_fkey') THEN
    ALTER TABLE "urgent_visit_records"
      ADD CONSTRAINT "urgent_visit_records_appointmentId_fkey"
      FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'urgent_visit_records_submittedById_fkey') THEN
    ALTER TABLE "urgent_visit_records"
      ADD CONSTRAINT "urgent_visit_records_submittedById_fkey"
      FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 6. user_settings: add theme color columns (table created by index.ts on startup)
ALTER TABLE "user_settings"
  ADD COLUMN IF NOT EXISTS "primaryColor"   TEXT,
  ADD COLUMN IF NOT EXISTS "secondaryColor" TEXT,
  ADD COLUMN IF NOT EXISTS "buttonColor"    TEXT,
  ADD COLUMN IF NOT EXISTS "cardColor"      TEXT;
