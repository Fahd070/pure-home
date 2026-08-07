# Production Prisma Migration Guard

This document is the full background for the rule in the root [`CLAUDE.md`](../CLAUDE.md). It exists so any future session (human or Claude Code) understands *why* the rule exists, not just that it exists, before touching the database schema.

No passwords, database URLs, Supabase credentials, or other production secrets appear anywhere in this document.

## 1. Why the migration-tracking issue exists

Prisma tracks which migrations have been applied to a given database in a table it manages itself, `_prisma_migrations`. This tracking only reflects reality if the database was under Prisma's management from the start, or was correctly *baselined* (told "these migrations' effects already exist, mark them applied without re-running their SQL") when Prisma management began.

In this project, production's schema existed **before** Prisma migration tracking was fully established for it. Onboarding `_prisma_migrations` into production was started afterward, as a retrofit, not from day one. That onboarding process got partway through the repository's migration chain (M1 and M2 were successfully baselined/resolved) before running into Supabase connection/advisory-lock issues partway through M3–M6, and M7 was never reached at all. At that point the work was deliberately paused: the running application and the actual database schema were both healthy, so there was no urgent forcing function to push through the lock issues under time pressure.

## 2. Why the application can remain healthy despite this

Prisma's runtime query engine (what the deployed backend actually uses to read/write data) does **not** consult `_prisma_migrations` at all. It only cares whether the actual tables/columns/constraints it expects are present. If production's real schema already matches what migrations M3–M7 would have produced — which is the working assumption here, since the app has been operating normally — then the application functions correctly regardless of what `_prisma_migrations` says was or wasn't "applied."

This is exactly why the gap is safe to leave alone as long as nothing tries to layer new migrations on top of it, and exactly why it becomes dangerous the moment something does.

## 3. Why it becomes dangerous when a NEW migration is introduced

`prisma migrate deploy` (the command used to apply new migrations to production) decides what SQL to run by looking at `_prisma_migrations`, not by inspecting the live schema. If that table believes M3–M6 were never applied, a future `migrate deploy` could attempt to re-run their SQL — `CREATE TABLE`, `ALTER TABLE ADD COLUMN`, etc. — against a database that may already have those exact objects. Depending on the specific statements involved, this can fail outright (object already exists) or, worse, partially succeed in a way that corrupts data or leaves the schema in a state no migration file describes.

A brand-new migration (M8, or whatever comes next) deployed on top of this unreconciled history inherits that same risk: Prisma would try to apply it *after* running whatever it still believes is pending from M3–M7 first.

## 4. Known historical M1–M7 state

As last recorded (this is history, not a live status — see section 5):

| Migration | Recorded production state |
|---|---|
| M1 | Baselined |
| M2 | Baselined |
| M3 | Baselining incomplete |
| M4 | Baselining incomplete |
| M5 | Baselining incomplete |
| M6 | Baselining incomplete |
| M7 | Never deployed as part of the onboarding attempt |

The repository's actual migration directory names and count may not map 1:1 to this M1–M7 shorthand by the time a future session reads this — always cross-reference against the real `prisma/migrations/` folder and the real `_prisma_migrations` table contents, not this table's labels.

## 5. Current production state must always be re-verified

The table in section 4 is a historical snapshot, not a live source of truth. Time passes, other reconciliation work may happen outside of a recorded session, and Supabase itself may change. Before any reconciliation work begins, re-derive the actual current state directly:

- Read the actual contents of the production `_prisma_migrations` table (which migration names it has rows for, and their `finished_at`/`rolled_back_at` status).
- Compare that against the full list of migration folders in `packages/backend/prisma/migrations/`.
- Compare both of those against the actual live schema (table/column/constraint inventory) in production.

Only once those three views are reconciled with each other is it safe to reason about what a new migration would actually do.

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

- **Repository migration correctness** — whether the migration files in `packages/backend/prisma/migrations/` form a valid, applicable chain. This has been verified: all 7 migrations apply cleanly, in order, to a completely fresh disposable PostgreSQL database.
- **Production schema correctness** — whether the actual tables/columns/constraints/indexes in the live Supabase database are what the application code expects. This is believed to be correct (the app runs fine), but has not been formally re-proven against every migration's specific effects.
- **`_prisma_migrations` tracking correctness** — whether Prisma's own bookkeeping table accurately reflects what's really in the schema. This is the piece that is **known incomplete** (M3–M7 per the last recorded state).

The danger this whole document exists to prevent is treating any one of these three as a stand-in for the other two. Repository correctness says nothing about production's tracking correctness. Production schema correctness (the app working) says nothing about whether `_prisma_migrations` agrees. Only reconciling all three together, as described in section 5, makes it safe to deploy a new migration.
