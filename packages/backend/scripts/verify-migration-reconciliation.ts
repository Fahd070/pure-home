// Read-only verification for the production Prisma migration-history
// reconciliation (M1-M7). Confirms _prisma_migrations records all seven
// migrations as finished/not-rolled-back, that the appointments_customerId_fkey
// delete rule is SET NULL (M7's effect), and that no orphaned
// appointments.customerId references exist. Runs three SELECT-only queries --
// never writes anything. Exits non-zero on any mismatch.
//
// Usage (from packages/backend, DATABASE_URL pointed at the target database):
//   npm run migration:verify-reconciliation
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

function fail(message: string): never {
  console.error(`[migration-reconciliation-verify] FAILED: ${message}`);
  process.exit(1);
}

function step(message: string) {
  console.log(`[migration-reconciliation-verify] ${message}`);
}

const EXPECTED_MIGRATIONS = [
  '20260605221150_init',
  '20260609999999_create_user_settings_table',
  '20260610000000_feature_expansion',
  '20260611000000_amendments',
  '20260625000000_remove_tasks_system_and_add_versioning',
  '20260626000000_system_configs_and_remaining_columns',
  '20260627000000_appointments_customer_fk_set_null',
];

async function main() {
  const prisma = new PrismaClient();
  try {
    // 1. _prisma_migrations completeness: all seven present, finished, not rolled back.
    const rows = await prisma.$queryRawUnsafe<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>(
      `SELECT migration_name, finished_at, rolled_back_at FROM public."_prisma_migrations"`
    );
    const byName = new Map(rows.map(r => [r.migration_name, r]));
    for (const name of EXPECTED_MIGRATIONS) {
      const r = byName.get(name);
      if (!r) fail(`Migration not recorded in _prisma_migrations: ${name}`);
      if (!r!.finished_at) fail(`Migration recorded but finished_at is null: ${name}`);
      if (r!.rolled_back_at) fail(`Migration was rolled back: ${name}`);
    }
    step(`All ${EXPECTED_MIGRATIONS.length} expected migrations recorded, finished, not rolled back.`);

    // 2. appointments_customerId_fkey delete rule must be SET NULL ('n').
    const fk = await prisma.$queryRawUnsafe<Array<{ confdeltype: string }>>(`
      SELECT confdeltype FROM pg_constraint
      WHERE conname = 'appointments_customerId_fkey' AND contype = 'f'
    `);
    if (fk.length === 0) fail('appointments_customerId_fkey constraint not found');
    if (fk[0].confdeltype !== 'n') fail(`appointments_customerId_fkey delete rule is '${fk[0].confdeltype}', expected 'n' (SET NULL)`);
    step('appointments_customerId_fkey confirmed ON DELETE SET NULL.');

    // 3. No orphaned appointments.customerId references (would have blocked/broken the FK).
    const orphan = await prisma.$queryRawUnsafe<Array<{ count: number }>>(`
      SELECT COUNT(*)::int AS count FROM appointments a
      WHERE a."customerId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = a."customerId")
    `);
    if (orphan[0].count !== 0) fail(`Found ${orphan[0].count} orphaned appointments.customerId reference(s)`);
    step('No orphaned appointments.customerId references.');

    step('ALL CHECKS PASSED.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => fail(e?.message || String(e)));
