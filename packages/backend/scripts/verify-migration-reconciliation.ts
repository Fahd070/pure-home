// Read-only verification of a database's Prisma migration-history reconciliation.
//
// Confirms that `_prisma_migrations` records the COMPLETE repository migration
// chain as finished/not-rolled-back, that the appointments_customerId_fkey
// delete rule is SET NULL, and that no orphaned appointments.customerId
// references exist. SELECT-only -- never writes anything. Exits non-zero on any
// mismatch.
//
// The expected chain is DISCOVERED FROM prisma/migrations/ at run time rather
// than hardcoded. It previously carried a hardcoded seven-entry list written
// when the repository had exactly seven migrations; by the time the repository
// reached fourteen, that list silently verified only the first half of the
// chain and reported "ALL CHECKS PASSED" while seven migrations went unchecked.
// A verifier that cannot notice new migrations is worse than no verifier,
// because it produces false confidence at exactly the moment a new migration is
// about to be deployed. Dynamic discovery cannot drift out of date.
//
// Safety properties, all enforced by the database rather than by convention:
//   * Every statement runs inside an explicitly READ ONLY transaction, so any
//     accidental write/DDL is rejected by PostgreSQL (SQLSTATE 25006).
//   * statement_timeout and lock_timeout are set LOCAL to that transaction, so
//     this can never stall or block the target database.
//   * No `prisma migrate` subcommand is invoked (no deploy, resolve, or dev).
//   * DATABASE_URL is never printed, and anything connection-string shaped is
//     scrubbed out of error text before it is logged.
//
// Usage (from packages/backend, DATABASE_URL pointed at the target database):
//   npm run migration:verify-reconciliation            (before deploying)
//   npm run migration:verify-reconciliation -- --strict (after deploying)
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '..', 'prisma', 'migrations');

/**
 * `--strict` additionally requires that NOTHING is pending -- use it AFTER a
 * deployment to prove the chain landed completely. Without it, undeployed
 * repository migrations are reported but not treated as failure, which is the
 * correct behaviour for the pre-deployment check.
 */
const STRICT = process.argv.includes('--strict');

/** Removes anything connection-string shaped from arbitrary text before printing. */
function scrub(text: string): string {
  return text
    .replace(/postgres(ql)?:\/\/[^\s'"]*/gi, 'postgresql://[REDACTED]')
    .replace(/(password|pwd)=[^\s&'"]*/gi, '$1=[REDACTED]');
}

function fail(message: string): never {
  console.error(`[migration-reconciliation-verify] FAILED: ${scrub(message)}`);
  process.exit(1);
}

function step(message: string) {
  console.log(`[migration-reconciliation-verify] ${message}`);
}

/**
 * The single source of truth for "which migrations should this database have":
 * the repository's own migrations directory. Sorted so the reported order
 * matches Prisma's own timestamp-prefix ordering.
 */
export function discoverRepositoryMigrations(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

interface MigrationRow {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
  applied_steps_count: number | null;
}

async function main() {
  const expected = discoverRepositoryMigrations();
  if (expected.length === 0) {
    fail(`No migration directories found under ${MIGRATIONS_DIR}. Wrong working directory?`);
  }
  step(`Discovered ${expected.length} migration(s) in the repository.`);

  const prisma = new PrismaClient();
  try {
    const { rows, fkDeleteRule, orphanCount } = await prisma.$transaction(async (tx) => {
      // Must be the first statement in the transaction: from here on PostgreSQL
      // itself rejects any write, so read-only is guaranteed rather than assumed.
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30s'");
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");

      const migrationRows = await tx.$queryRawUnsafe<MigrationRow[]>(
        `SELECT migration_name, finished_at, rolled_back_at, applied_steps_count
         FROM public."_prisma_migrations"
         ORDER BY started_at`
      );

      const fk = await tx.$queryRawUnsafe<Array<{ confdeltype: string }>>(`
        SELECT confdeltype FROM pg_constraint
        WHERE conname = 'appointments_customerId_fkey' AND contype = 'f'
      `);

      const orphan = await tx.$queryRawUnsafe<Array<{ count: number }>>(`
        SELECT COUNT(*)::int AS count FROM appointments a
        WHERE a."customerId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = a."customerId")
      `);

      return {
        rows: migrationRows,
        fkDeleteRule: fk.length > 0 ? fk[0].confdeltype : null,
        orphanCount: orphan[0].count,
      };
    });

    // 1. Completeness, distinguishing the two very different kinds of mismatch.
    //
    // A repository migration the database has not received yet is NOT drift --
    // it is the normal, expected state immediately BEFORE a deployment, which is
    // exactly when CLAUDE.md tells you to run this. Treating it as fatal made the
    // documented gate impossible to pass in the one situation it exists for, and
    // made "not deployed yet" indistinguishable from real corruption.
    //
    // What IS fatal: a migration recorded but unfinished, a migration rolled
    // back, or (section 2) the database holding migrations this repository does
    // not have.
    const byName = new Map(rows.map((r) => [r.migration_name, r]));
    const pending: string[] = [];
    for (const name of expected) {
      const row = byName.get(name);
      if (!row) { pending.push(name); continue; }
      if (!row.finished_at) fail(`Migration recorded but finished_at is null: ${name}`);
      if (row.rolled_back_at) fail(`Migration was rolled back: ${name}`);
    }

    // Pending migrations must be a CONTIGUOUS TAIL of the chain. A gap -- an
    // undeployed migration sitting before a deployed one -- means the chain was
    // applied out of order, which is genuine corruption and never an
    // "about to deploy" state.
    if (pending.length > 0) {
      const firstPendingIndex = expected.findIndex((n) => pending.includes(n));
      const tail = expected.slice(firstPendingIndex);
      const outOfOrder = tail.filter((n) => !pending.includes(n));
      if (outOfOrder.length > 0) {
        fail(`Migration chain applied out of order -- deployed after an undeployed one: ${outOfOrder.join(', ')}`);
      }
    }

    const applied = expected.length - pending.length;
    step(`${applied}/${expected.length} repository migrations recorded, finished, not rolled back.`);
    if (pending.length > 0) {
      step(`NOT YET DEPLOYED (expected before a deployment, fatal only with --strict): ${pending.join(', ')}`);
      if (STRICT) fail(`--strict: ${pending.length} repository migration(s) are not deployed.`);
    }

    // 2. Drift the other way: the database knows a migration this repository does
    //    not contain, meaning the working tree is behind the target database.
    const expectedSet = new Set(expected);
    const unknown = rows.map((r) => r.migration_name).filter((name) => !expectedSet.has(name));
    if (unknown.length > 0) {
      fail(`Database has migration(s) absent from this repository: ${unknown.join(', ')}`);
    }
    step('No unknown migrations present in the database.');

    // 3. appointments_customerId_fkey delete rule must be SET NULL ('n').
    if (fkDeleteRule === null) fail('appointments_customerId_fkey constraint not found');
    if (fkDeleteRule !== 'n') {
      fail(`appointments_customerId_fkey delete rule is '${fkDeleteRule}', expected 'n' (SET NULL)`);
    }
    step('appointments_customerId_fkey confirmed ON DELETE SET NULL.');

    // 4. No orphaned appointments.customerId references.
    if (orphanCount !== 0) fail(`Found ${orphanCount} orphaned appointments.customerId reference(s)`);
    step('No orphaned appointments.customerId references.');

    step('ALL CHECKS PASSED.');
  } catch (e: any) {
    // fail() already exited for expected mismatches; this covers connection and
    // query errors, whose messages can embed the connection string.
    fail(e?.message || String(e));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => fail(e?.message || String(e)));
