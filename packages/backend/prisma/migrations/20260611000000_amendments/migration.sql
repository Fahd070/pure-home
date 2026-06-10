-- Amendment: make customerId nullable on appointments (urgent appts have no customer)
ALTER TABLE "appointments" ALTER COLUMN "customerId" DROP NOT NULL;

-- Drop old CASCADE constraint and add SET NULL
ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_customerId_fkey";
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add urgentLocation to appointments
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "urgentLocation" TEXT;

-- Add completion fields to maintenance_tasks
ALTER TABLE "maintenance_tasks" ADD COLUMN IF NOT EXISTS "serviceDetails" TEXT;
ALTER TABLE "maintenance_tasks" ADD COLUMN IF NOT EXISTS "completionAmount" DOUBLE PRECISION;
ALTER TABLE "maintenance_tasks" ADD COLUMN IF NOT EXISTS "completionPaymentMethod" TEXT;

-- Extend urgent_visit_records with new customer & service fields
ALTER TABLE "urgent_visit_records" ADD COLUMN IF NOT EXISTS "customerName" TEXT;
ALTER TABLE "urgent_visit_records" ADD COLUMN IF NOT EXISTS "customerPhone" TEXT;
ALTER TABLE "urgent_visit_records" ADD COLUMN IF NOT EXISTS "customerDetails" TEXT;
ALTER TABLE "urgent_visit_records" ADD COLUMN IF NOT EXISTS "serviceNotes" TEXT;
ALTER TABLE "urgent_visit_records" ADD COLUMN IF NOT EXISTS "serviceType" TEXT;
ALTER TABLE "urgent_visit_records" ADD COLUMN IF NOT EXISTS "amount" DOUBLE PRECISION;
