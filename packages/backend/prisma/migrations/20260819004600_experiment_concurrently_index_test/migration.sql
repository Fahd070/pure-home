-- EXPERIMENTAL, THROWAWAY migration. Never intended to be merged into main
-- or applied to production. Exists only to prove, via this exact repo's
-- `prisma migrate deploy --schema=prisma/schema.prisma` path (as run by
-- .github/workflows/production-validation.yml's disposable Postgres service
-- container), whether a migration.sql containing CREATE INDEX CONCURRENTLY
-- can be applied without Prisma wrapping it in a failing transaction block.
-- Deliberately not reflected in schema.prisma (migrate deploy does not diff
-- against schema.prisma; it only applies pending migration.sql files), so
-- this experiment does not require any schema.prisma change.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_experiment_concurrently_test" ON "appointments"("isUrgent");
