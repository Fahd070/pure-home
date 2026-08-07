# CRITICAL: Production Prisma Migration History Must Be Reconciled Before Schema Changes

The production Supabase database currently has incomplete Prisma migration-history onboarding.

Repository migrations are valid and have been verified successfully against a fresh PostgreSQL database, but production Prisma migration tracking is not yet fully reconciled.

Known production migration-tracking state (last recorded — **must be re-verified, see below**):

- M1: baselined
- M2: baselined
- M3-M6: production baselining incomplete / must be re-verified
- M7: production status must be re-verified before any new migration is deployed

IMPORTANT: The exact production state MUST be inspected again before acting. Do not blindly assume the historical status above is still current.

Full background: [`docs/PRODUCTION-PRISMA-MIGRATION-GUARD.md`](docs/PRODUCTION-PRISMA-MIGRATION-GUARD.md).

## Mandatory rule

BEFORE doing ANY of the following:

- modifying `prisma/schema.prisma`
- creating a Prisma migration
- editing an existing migration
- adding/removing/renaming a database table
- adding/removing/renaming/changing a database column
- changing indexes
- changing foreign keys
- changing relations
- changing constraints
- changing enums
- running `prisma migrate deploy` against production
- running `prisma migrate resolve` against production
- running any DDL against production

STOP the requested schema-change task temporarily.

First:

1. Inform the user that production Prisma migration history has a known unresolved onboarding/baselining issue.
2. Explain that this must be reconciled BEFORE introducing a new schema migration.
3. Inspect the CURRENT production migration state safely.
4. Compare:
   - repository migrations
   - `_prisma_migrations`
   - actual production schema
5. Produce the exact reconciliation plan.
6. Resolve/reconcile the historical migration state safely before creating or deploying any NEW schema migration.

## Production safety

Never:

- blindly rerun old migrations against production
- assume an unapplied Prisma migration means its SQL changes are absent from production
- delete or recreate production tables to make migration history match
- reset the production database
- use `prisma migrate reset` against production
- modify production migration metadata without first proving the actual schema state
- alter production data merely to satisfy Prisma migration history

Production data preservation has priority.

## Fresh-development databases

This warning does NOT prevent:

- running the existing migration chain against disposable/local test databases
- `prisma migrate deploy` against a fresh disposable test database
- Prisma validation/generation
- testing existing migrations in CI

It specifically prevents NEW DATABASE STRUCTURE WORK from proceeding until production migration tracking is reconciled.

## Required user warning

If a future task requests a database schema change, explicitly tell the user:

> "Before I modify the database structure, this project has a documented unresolved production Prisma migration-history issue. We need to reconcile the production migration state first so a new migration does not conflict with schema changes that already exist in Supabase."

Do not silently bypass this rule.
