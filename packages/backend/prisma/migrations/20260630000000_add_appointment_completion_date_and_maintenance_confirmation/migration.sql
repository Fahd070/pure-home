-- Modification #8: adds the Technician-declared actual completion/operation
-- date, and a boolean tracking whether Scheduling/Maintenance has reviewed and
-- confirmed that completion. Both additive and backward-safe; no other schema
-- changes; no data is deleted or transformed.
--
-- actualCompletionDate is nullable -- historical completed appointments simply
-- have no value (existing behavior unaffected).
-- maintenanceConfirmed defaults false -- every existing appointment (and every
-- new completion going forward) starts unconfirmed until Scheduling explicitly
-- confirms it; nothing currently depends on this being true.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "actualCompletionDate" TIMESTAMP(3);
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "maintenanceConfirmed" BOOLEAN NOT NULL DEFAULT false;
