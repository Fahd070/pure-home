// Standalone entrypoint run via `ts-node` from the `pretest` npm script, BEFORE
// `prisma migrate deploy` ever touches DATABASE_URL. Exits non-zero (and prints why)
// if DATABASE_URL does not look like a safe local/disposable test database.
import 'dotenv/config';
import { assertSafeTestDatabaseUrl } from './dbSafety';

try {
  assertSafeTestDatabaseUrl(process.env.DATABASE_URL);
  console.log('[db-safety] DATABASE_URL looks like a local disposable test database. Proceeding.');
} catch (e: any) {
  console.error(`[db-safety] BLOCKED: ${e.message}`);
  process.exit(1);
}
