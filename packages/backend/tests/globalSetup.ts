// Vitest global setup: runs once, before any test file, in every invocation
// (including `npx vitest` run directly, bypassing the pretest npm script). This is
// the second, redundant layer of the database safety guard -- defense in depth.
import { assertSafeTestDatabaseUrl } from './helpers/dbSafety';

export default function globalSetup() {
  assertSafeTestDatabaseUrl(process.env.DATABASE_URL);
}
