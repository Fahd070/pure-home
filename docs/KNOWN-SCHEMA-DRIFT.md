# Known schema drift: `system_configs.updatedAt`

## Status

**Open. Pre-existing. Deliberately NOT fixed in the v4 Phase 1 branch.**

## What it is

`npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma` emits exactly one statement that no migration accounts for:

```sql
ALTER TABLE "system_configs" ALTER COLUMN "updatedAt" DROP DEFAULT;
```

Migration `20260626000000_system_configs_and_remaining_columns` created the column as:

```sql
"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
```

while `schema.prisma` declares it as `updatedAt DateTime @updatedAt`, which Prisma models with **no** database-level default. The chain and the model have therefore disagreed since that migration was written.

## It predates Phase 1

Verified, not assumed: the same one-line diff is produced on a clean checkout of `main` at `78754ea`, with the Phase 1 branch's `schema.prisma` changes stashed. It has nothing to do with technician identity, the maintenance-due engine, customer branches, or the notification foundation.

## Why it was excluded from migration `20260909120000`

That migration is described as, and audited as, an additive core-domain and identity change. Folding an unrelated production DDL statement into it would make its real blast radius larger than its description — which is precisely the failure mode the production migration guard exists to prevent. A reviewer approving "add technician access codes and a due date" would also, silently, be approving an `ALTER COLUMN` on the table that holds every department's access code.

## Is it harmful right now?

No, and this is why it is safe to leave open:

- `@updatedAt` is applied by the Prisma client on every write, so the column is always populated by the application regardless of whether the database also has a default.
- Nothing reads the database default.
- The drift is a *missing* `DROP DEFAULT`, i.e. production has an **extra** default the model does not know about. That is inert, not corrupting.

## What must happen before it is fixed

This change touches `system_configs`, the table holding department access codes. It therefore needs its own deliberate pass, not a drive-by:

1. A **dedicated read-only reconciliation** against production first — confirm the column's actual current definition, and confirm `_prisma_migrations` still matches the repository chain (`npm run migration:verify-reconciliation`).
2. Its **own migration**, containing only this statement, so it can be reviewed, deployed and rolled back independently.
3. Deployment through the same gated, manually-dispatched workflow used for every prior production migration.

**Do not deploy any production migration that carries this statement bundled with unrelated changes.**

## Do not

- Do not add this statement to migration `20260909120000_v4_core_domain_technician_identity`.
- Do not "fix" it by editing an already-applied historical migration file — production's `_prisma_migrations` records a checksum for `20260626000000`, and rewriting it would make that record inconsistent with the file.
