# Production Prisma Migration Guard

This document is the full background for the rule in the root [`CLAUDE.md`](../CLAUDE.md). It exists so any future session (human or Claude Code) understands *why* the rule exists, not just that it exists, before touching the database schema.

No passwords, database URLs, Supabase credentials, or other production secrets appear anywhere in this document.

> **Status:** the historical migration-tracking gap this document was written about **has been reconciled** — see section 4 for the outcome and the last verified date. Sections 1–3 are retained because they explain *why* the verification rule exists and what failure mode it protects against; they describe history, not the current state. The rule in section 5 still applies before every new migration.

## 1. Why the migration-tracking issue existed

Prisma tracks which migrations have been applied to a given database in a table it manages itself, `_prisma_migrations`. This tracking only reflects reality if the database was under Prisma's management from the start, or was correctly *baselined* (told "these migrations' effects already exist, mark them applied without re-running their SQL") when Prisma management began.

In this project, production's schema existed **before** Prisma migration tracking was fully established for it. Onboarding `_prisma_migrations` into production was started afterward, as a retrofit, not from day one. That onboarding process got partway through the repository's migration chain (M1 and M2 were successfully baselined/resolved) before running into Supabase connection/advisory-lock issues partway through M3–M6, and M7 was never reached at all. At that point the work was deliberately paused: the running application and the actual database schema were both healthy, so there was no urgent forcing function to push through the lock issues under time pressure.

## 2. Why the application can remain healthy despite this

Prisma's runtime query engine (what the deployed backend actually uses to read/write data) does **not** consult `_prisma_migrations` at all. It only cares whether the actual tables/columns/constraints it expects are present. If production's real schema already matches what migrations M3–M7 would have produced — which is the working assumption here, since the app has been operating normally — then the application functions correctly regardless of what `_prisma_migrations` says was or wasn't "applied."

This is exactly why the gap is safe to leave alone as long as nothing tries to layer new migrations on top of it, and exactly why it becomes dangerous the moment something does.

## 3. Why it becomes dangerous when a NEW migration is introduced

`prisma migrate deploy` (the command used to apply new migrations to production) decides what SQL to run by looking at `_prisma_migrations`, not by inspecting the live schema. If that table believes M3–M6 were never applied, a future `migrate deploy` could attempt to re-run their SQL — `CREATE TABLE`, `ALTER TABLE ADD COLUMN`, etc. — against a database that may already have those exact objects. Depending on the specific statements involved, this can fail outright (object already exists) or, worse, partially succeed in a way that corrupts data or leaves the schema in a state no migration file describes.

A brand-new migration (M8, or whatever comes next) deployed on top of this unreconciled history inherits that same risk: Prisma would try to apply it *after* running whatever it still believes is pending from M3–M7 first.

## 4. Reconciliation outcome and last verified state

**The gap described in sections 1–3 was closed.** This section previously carried an "M1–M7" status table recording migrations 3–6 as never baselined and 7 as never reached. That table went stale twice over: the reconciliation completed on 2026-08-09, and the repository grew from 7 migrations to 14 while the table still described only the first 7.

### What actually happened

- **2026-08-09** — the baselining of the then-outstanding migrations was completed. Migrations 1–6 were resolved as applied without replaying their SQL (`applied_steps_count = 0`), which is the correct outcome for a baselined migration whose effects already existed in the schema.
- **2026-08-09 onward** — every migration added since has been applied by Prisma itself through a gated, manually-dispatched workflow (`applied_steps_count = 1`), each one verifying the prior chain state before writing.
- **2026-09-09** — a read-only confirmation reported all 14 repository migrations recorded, finished, not rolled back, with no unknown extras in production.

### Last verified state (2026-09-09)

| Migrations | Count | Recorded production state |
|---|---|---|
| `20260605221150_init` … `20260626000000_system_configs_and_remaining_columns` | 6 | Baselined (`applied_steps_count = 0`) |
| `20260627000000_appointments_customer_fk_set_null` … `20260818194741_add_customer_installation_details` | 8 | Deployed by Prisma (`applied_steps_count = 1`) |

### Why this section is still not a substitute for verifying

A recorded "all clear" is more dangerous than a recorded warning, because it invites action rather than caution. Do not read this section and proceed. Read it to know the expected starting point, then verify per section 5 — and update the date above with the result.

Deliberately, this section names **no fixed migration count**. Migration names and counts change; a number written here would be wrong the moment the next migration is created, which is exactly how the previous table came to describe half a chain. Always cross-reference the real `prisma/migrations/` directory against the real `_prisma_migrations` contents.

## 5. Current production state must always be re-verified

Section 4 is a historical snapshot, not a live source of truth. Time passes, other work may happen outside of a recorded session, and Supabase itself may change. Before any new migration is created or deployed, re-derive the actual current state directly:

- Read the actual contents of the production `_prisma_migrations` table (which migration names it has rows for, and their `finished_at`/`rolled_back_at` status).
- Compare that against the full list of migration folders in `packages/backend/prisma/migrations/`.
- Compare both of those against the actual live schema (table/column/constraint inventory) in production.

Only once those three views are reconciled with each other is it safe to reason about what a new migration would actually do.

### The repository's own checker

`packages/backend/scripts/verify-migration-reconciliation.ts` (`npm run migration:verify-reconciliation`) performs the first two comparisons, plus two schema assertions. Its safety properties are enforced by PostgreSQL rather than by convention:

- Every statement runs inside an explicit `SET TRANSACTION READ ONLY` transaction, so any accidental write or DDL is rejected by the server (SQLSTATE `25006`), not merely avoided by the code.
- `statement_timeout` and `lock_timeout` are set `LOCAL` to that transaction, so it cannot stall or block production.
- No `prisma migrate` subcommand is invoked — no `deploy`, no `resolve`, no `dev`.
- `DATABASE_URL` is never printed, and connection-string-shaped text is scrubbed from error output.

It also checks for **drift in both directions**: a repository migration missing from the database, and a database migration absent from the repository (meaning the working tree is behind production).

Critically, it discovers the expected chain by reading `prisma/migrations/` at run time. It previously carried a hardcoded seven-entry list, which silently verified only half the chain once the repository reached fourteen migrations and still reported `ALL CHECKS PASSED`. **Never reintroduce a hardcoded expected-migration list**: a verifier that cannot notice new migrations produces false confidence at exactly the moment a new migration is about to be deployed.

## 6. Safe reconciliation principles

- **Read before you write.** Every step of reconciliation starts with inspection (`SELECT` against `_prisma_migrations`, `\d` / information_schema queries against the live schema) — never a mutating command as a first move.
- **Prove equivalence before baselining.** `prisma migrate resolve --applied <name>` should only be used once it's been positively confirmed that the named migration's SQL effects already exist in the live schema — not assumed.
- **One migration at a time.** Reconcile and verify each unresolved migration individually rather than batch-resolving M3 through M7 in one pass, so a mistake is isolated and identifiable.
- **Prefer the least destructive action available.** If a migration's effects are only partially present, the fix is a hand-written corrective migration that brings the schema the rest of the way there — not dropping and recreating objects to force a clean slate.
- **Never let migration-history bookkeeping drive schema changes.** The live schema and the application's real data are the source of truth; `_prisma_migrations` is a record of history, not something to edit reality around.
- **Rehearse against a copy first.** Where practical, validate the reconciliation plan's understanding of production's schema (e.g., via a schema dump/introspection) before running anything against production itself.

## 7. Actions that must never be used blindly in production

- `prisma migrate reset` — drops and recreates the database. Never run against production under any circumstances.
- `prisma migrate deploy` — safe in general, but not until `_prisma_migrations` is reconciled; until then it may attempt to replay SQL that already effectively exists.
- `prisma migrate resolve` — only after positively proving the named migration's effects are (or are not) already present; never as a guess to "make the error go away."
- Manual `DROP TABLE` / `DROP COLUMN` / recreate-to-match-migration-history — destroys data to satisfy bookkeeping; never acceptable.
- Any bulk/batch resolve of multiple migrations at once without individually verifying each one first.

## 8. Three distinct kinds of "correct," and why conflating them is the actual risk

- **Repository migration correctness** — whether the migration files in `packages/backend/prisma/migrations/` form a valid, applicable chain. Verified continuously: the full chain is applied to a fresh disposable PostgreSQL database by the Production Validation workflow on every PR and every push to `main`, and again locally before any new migration is proposed. Deliberately stated without a count, so this line cannot go stale as the chain grows.
- **Production schema correctness** — whether the actual tables/columns/constraints/indexes in the live Supabase database are what the application code expects. Strongly evidenced (the app runs, and each migration since 2026-08-09 was applied by Prisma itself with its effects verified afterward), but the only way to *prove* it for a specific migration's effects remains a direct read-only schema inspection.
- **`_prisma_migrations` tracking correctness** — whether Prisma's own bookkeeping table accurately reflects what's really in the schema. This was the piece that was historically incomplete. It was reconciled on 2026-08-09 and last confirmed on 2026-09-09 (section 4). It is the piece most likely to drift silently again, because nothing in the running application ever reads it.

The danger this whole document exists to prevent is treating any one of these three as a stand-in for the other two. Repository correctness says nothing about production's tracking correctness. Production schema correctness (the app working) says nothing about whether `_prisma_migrations` agrees. Only reconciling all three together, as described in section 5, makes it safe to deploy a new migration.
