-- Part D: maintenanceFrequency must support half-month increments (1, 1.5, 2,
-- 2.5, 3, 3.5, ...). Changed from INTEGER to DOUBLE PRECISION. Every value
-- this column will ever hold is a positive multiple of 0.5, validated at the
-- API layer (see routes/customers.ts) -- 0.5 is exactly representable in
-- IEEE-754 double precision (binary fraction 2^-1), so this introduces no
-- rounding/precision loss for the restricted value set this column holds.
-- Every existing integer value converts losslessly (every int fits exactly
-- in a double), so no existing production data is altered by this migration.
ALTER TABLE "customers" ALTER COLUMN "maintenanceFrequency" SET DEFAULT 1,
ALTER COLUMN "maintenanceFrequency" SET DATA TYPE DOUBLE PRECISION;

-- NOTE: `prisma migrate dev` also proposed `ALTER TABLE "system_configs"
-- ALTER COLUMN "updatedAt" DROP DEFAULT;` here. That is unrelated pre-existing
-- drift between schema.prisma (`updatedAt DateTime @updatedAt`, no DB-level
-- default) and migration 20260626000000_system_configs_and_remaining_columns
-- (which set `DEFAULT CURRENT_TIMESTAMP` to match production's raw-SQL-created
-- table). Deliberately NOT included in this migration -- out of scope for
-- Part D, and harmless to leave as-is (Prisma Client always sets `updatedAt`
-- explicitly on every update; the stale DB-level default is unused, never
-- incorrect). Flagged for the user in the batch's final report, not fixed here.
