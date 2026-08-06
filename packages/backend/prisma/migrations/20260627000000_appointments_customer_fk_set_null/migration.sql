-- Recorded business decision: appointments.customerId should use ON DELETE SET NULL,
-- not CASCADE, so appointment history survives a customer deletion.
--
-- Verified via read-only production metadata (2026-08-07) before writing this:
-- appointments_customerId_fkey is currently ON DELETE CASCADE in production.
-- packages/backend/src/index.ts's ensureSchemaUpdates() raw-SQL startup helper has been
-- silently re-asserting CASCADE on every single backend boot, overriding whatever an
-- earlier, never-deployed migration (20260611000000_amendments) intended. This
-- migration is the actual, tracked fix; the startup helper is removed in the same
-- change (see index.ts).
--
-- Behavior change (intentional, approved): after this migration, deleting a customer
-- no longer cascade-deletes their appointments -- appointments are preserved with
-- customerId set to NULL instead. No data is lost by this migration itself (it only
-- changes future DELETE behavior, not existing rows).

ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_customerId_fkey";
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
