# CRITICAL: Production Prisma Migration History Must Be Verified Before Schema Changes

Production Prisma migration history **was reconciled** and is currently believed to be complete. The historical onboarding/baselining gap that this document originally warned about (migrations 3–6 never baselined, 7 never reached) was closed on **2026-08-09**, and every migration added since has been deployed through a gated workflow.

Last verified: **2026-09-09**, by a read-only confirmation against production.

Result of that verification — all 14 repository migrations recorded, finished, and not rolled back, with no unknown extra migrations present:

- Migrations 1–6: baselined (`applied_steps_count = 0` — their SQL was correctly never replayed)
- Migrations 7–14: deployed by Prisma (`applied_steps_count = 1`)

## UNDEPLOYED MIGRATIONS PENDING PRODUCTION VERIFICATION

The verification recorded above covers migrations **1–14**. Since it was taken, the
repository has gained two migrations that have **NOT** been deployed to production and
whose production state has **NOT** been verified:

| # | Migration | Status |
|---|---|---|
| 15 | `20260909120000_v4_core_domain_technician_identity` | in repo, **not deployed**, validated only on a disposable database |
| 16 | `20260910180000_add_notification_english_localization` | in repo, **not deployed**, validated only on a disposable database |

Migration 16 was authored in a session that had **no production credentials available**,
so the mandatory read-only production check could not be run at all — it was neither
passed nor failed. That is why no new "Last verified" date appears above: writing one
would assert a check that never happened. Both migrations are purely additive and were
validated by deploying the complete chain 1→16 against a fresh disposable PostgreSQL
database (16 recorded, 16 finished, 0 rolled back), which is the only claim being made.

**Before deploying either migration, run the read-only checker below and reconcile any
disagreement first.** Do not treat the 2026-09-09 result as covering them.

**This status is a snapshot, not a standing guarantee.** It is written down so a future session knows the starting point — never so it can skip verifying. Time passes, work happens outside recorded sessions, and a stale "all clear" is more dangerous than a stale warning because it invites action. The exact production state MUST be re-verified before any new migration is deployed. Do not assume the status above is still current.

Verify with the repository's own read-only checker, which discovers the expected chain from `prisma/migrations/` rather than any hardcoded list:

```
# BEFORE deploying a new migration -- repository migrations not yet deployed are
# reported as pending, not treated as failure:
cd packages/backend && npm run migration:verify-reconciliation

# AFTER deploying -- requires the chain to have landed completely:
cd packages/backend && npm run migration:verify-reconciliation -- --strict
```

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

1. Inform the user that this project requires production Prisma migration history to be re-verified before any new schema migration, and state when it was last verified (see the top of this file).
2. Explain that the verification must pass BEFORE introducing a new schema migration.
3. Inspect the CURRENT production migration state safely — read-only, no `prisma migrate` subcommand of any kind.
4. Compare:
   - repository migrations (discovered from `prisma/migrations/`, never a hardcoded list)
   - `_prisma_migrations`
   - actual production schema
5. If they agree, record the new verification date at the top of this file and proceed.
6. If they DISAGREE, stop immediately. Do not create or deploy a new migration. Produce the exact reconciliation plan and resolve the historical migration state safely first.

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

> "Before I modify the database structure, this project requires a read-only confirmation that production's Prisma migration history still matches the repository. It was reconciled and last verified on the date recorded in CLAUDE.md, but that is a snapshot — we re-verify before every new migration so one cannot conflict with schema changes that already exist in Supabase."

Do not silently bypass this rule. A recorded "verified" date is never a substitute for verifying.
