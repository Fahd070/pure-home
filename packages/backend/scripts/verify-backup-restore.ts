// Restores a pg_dump backup into an isolated, disposable PostgreSQL database and
// verifies the result is structurally and logically sound -- proving the backup
// mechanism actually produces something restorable, not just that `pg_dump` exited 0.
//
// Usage (from packages/backend):
//   RESTORE_TEST_DATABASE_URL="postgresql://postgres:test@localhost:PORT/wfm_restore_test" \
//     npm run backup:verify -- /path/to/backup.dump
//
// Never targets production. RESTORE_TEST_DATABASE_URL is checked with the same
// technical safety guard used by the permanent test suite (tests/helpers/dbSafety.ts)
// before any pg_restore command is ever executed.
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { assertSafeTestDatabaseUrl } from '../tests/helpers/dbSafety';

function fail(message: string): never {
  console.error(`[backup-verify] FAILED: ${message}`);
  process.exit(1);
}

function step(message: string) {
  console.log(`[backup-verify] ${message}`);
}

// Derives the expected table list directly from prisma/schema.prisma's @@map(...)
// declarations -- never a hand-maintained list that can silently drift out of sync
// with the real schema (see docs/DATABASE-RESTORE.md for why this matters: an
// earlier backup doc listed tables removed months ago).
function expectedTablesFromSchema(): string[] {
  const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  const tables: string[] = [];
  const re = /@@map\("([a-z_]+)"\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(schema))) tables.push(m[1]);
  if (tables.length === 0) fail('Could not extract any table names from prisma/schema.prisma -- refusing to verify against an empty expectation list.');
  return tables;
}

async function main() {
  const backupFile = process.argv[2];
  if (!backupFile) fail('Usage: verify-backup-restore.ts <path-to-backup.dump>');

  // 1. Required environment
  const targetUrl = process.env.RESTORE_TEST_DATABASE_URL;
  if (!targetUrl) fail('RESTORE_TEST_DATABASE_URL is not set. It must point to an empty, disposable database (see docs/DATABASE-RESTORE.md).');

  // 2. Target safety -- same guard the permanent test suite uses. A typo here must
  // never be able to point a restore at Supabase/Render/production.
  // (assertSafeTestDatabaseUrl already requires localhost/127.0.0.1 and a database
  // name containing "test" -- "wfm_restore_test" satisfies that as-is.)
  try {
    assertSafeTestDatabaseUrl(targetUrl);
  } catch (e: any) {
    fail(`RESTORE_TEST_DATABASE_URL failed the safety check: ${e.message}`);
  }
  step(`Target verified safe (disposable, non-production): ${targetUrl.replace(/:[^:@/]+@/, ':***@')}`);

  // 3. Backup file exists and is non-empty
  if (!fs.existsSync(backupFile)) fail(`Backup file not found: ${backupFile}`);
  const sizeBytes = fs.statSync(backupFile).size;
  if (sizeBytes === 0) fail(`Backup file is empty: ${backupFile}`);
  step(`Backup file: ${backupFile} (${Math.round(sizeBytes / 1024)} KB)`);

  // 4. Inspect archive validity before touching any database (custom-format dumps
  // only -- pg_restore --list reads the table of contents without restoring anything).
  let objectCount = 0;
  try {
    const listing = execFileSync('pg_restore', ['--list', backupFile], { encoding: 'utf-8' });
    objectCount = listing.split('\n').filter((l) => l.trim() && !l.startsWith(';')).length;
  } catch (e: any) {
    fail(`pg_restore --list failed -- the backup archive is not readable/valid: ${e.message}`);
  }
  if (objectCount < 5) fail(`Archive contains only ${objectCount} objects -- suspiciously low, refusing to proceed.`);
  step(`Archive valid: ${objectCount} objects listed.`);

  // 5. Restore into the disposable target. The backup is scoped to --schema=public
  // (WFM's exclusive schema), so the archive includes its own `CREATE SCHEMA public`
  // statement -- and every fresh Postgres database already has a "public" schema by
  // default, so a plain restore fails with "schema already exists" even though the
  // target has none of WFM's own tables yet. --clean --if-exists is the correct,
  // standard fix (not error suppression): --if-exists makes every DROP idempotent
  // regardless of whether the object already existed, so the restore is safe and
  // fully deterministic whether the target is brand new or already holds a prior
  // restore -- and any OTHER failure still exits non-zero and is treated as fatal.
  step('Restoring into disposable target database...');
  try {
    execFileSync('pg_restore', ['--no-acl', '--no-owner', '--clean', '--if-exists', '--dbname', targetUrl, backupFile], { stdio: 'pipe' });
  } catch (e: any) {
    const stderr = e?.stderr?.toString?.() || e.message;
    fail(`pg_restore failed -- restore did not complete cleanly:\n${stderr}`);
  }
  step('Restore command completed with no errors.');

  // 6-9. Structural + logical verification via Prisma against the restored DB.
  const prisma = new PrismaClient({ datasources: { db: { url: targetUrl } } });
  try {
    // Database accepts connections / Prisma can query it.
    await prisma.$queryRaw`SELECT 1`;
    step('Restored database accepts connections and is queryable.');

    const expectedTables = expectedTablesFromSchema();
    const presentRows = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
      expectedTables
    );
    const present = new Set(presentRows.map((r) => r.table_name));
    const missing = expectedTables.filter((t) => !present.has(t));
    if (missing.length > 0) fail(`Missing expected table(s) after restore: ${missing.join(', ')}`);
    step(`All ${expectedTables.length} expected tables present: ${expectedTables.join(', ')}`);

    // Row counts -- table + count only, never row contents. Zero rows is valid.
    console.log('[backup-verify] Row counts:');
    for (const table of expectedTables) {
      const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`SELECT COUNT(*)::bigint AS count FROM "${table}"`);
      console.log(`  ${table.padEnd(24)} ${rows[0].count}`);
    }

    // Foreign-key/schema integrity: the restored database must have real relational
    // structure, not just bare tables with no constraints.
    const fkRows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM information_schema.table_constraints
      WHERE constraint_type = 'FOREIGN KEY' AND table_schema = 'public'
    `;
    const fkCount = Number(fkRows[0].count);
    if (fkCount === 0) fail('Restored database has zero foreign-key constraints -- schema integrity did not survive the restore.');
    step(`Foreign-key constraints present: ${fkCount}.`);

    // Representative read-only sanity query -- aggregate/count only, never selects
    // actual column values (customer names, phone numbers, messages, etc).
    const joinCheck = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM "appointments" a
      LEFT JOIN "customers" c ON c.id = a."customerId"
    `;
    step(`Sanity join query (appointments ⋈ customers) executed successfully: ${joinCheck[0].count} rows.`);
  } finally {
    await prisma.$disconnect();
  }

  console.log('');
  console.log('[backup-verify] SUCCESS: backup restored into an isolated database and verified.');
}

main().catch((e) => fail(e?.message || String(e)));
