// Technical (not just documented) guard against running the destructive integration
// test suite against anything other than an explicit local/disposable database.
// Called both as a standalone pretest script (tests/helpers/checkTestDb.ts) and again
// inside vitest's globalSetup, so there is no way to bypass it by invoking vitest
// directly or by skipping the npm script.

const UNSAFE_HOST_PATTERNS: RegExp[] = [
  /supabase\.co$/i,
  /supabase\.com$/i,
  /onrender\.com$/i,
  /render\.com$/i,
  /amazonaws\.com$/i,
  /vercel-storage\.com$/i,
];

export function assertSafeTestDatabaseUrl(rawUrl: string | undefined): void {
  if (!rawUrl || rawUrl.trim().length === 0) {
    throw new Error(
      'DATABASE_URL is not set. Point it at a local disposable Postgres database before running tests (see tests/README.md).'
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('DATABASE_URL is not a valid connection URL. Refusing to run tests.');
  }

  const host = parsed.hostname.toLowerCase();

  for (const pattern of UNSAFE_HOST_PATTERNS) {
    if (pattern.test(host)) {
      throw new Error(
        `Refusing to run tests: DATABASE_URL host "${host}" matches a known production/cloud hosting pattern. ` +
        `Tests must target an explicit local disposable database only, never Supabase/Render/any cloud host.`
      );
    }
  }

  const isLocalHost = host === 'localhost' || host === '127.0.0.1';
  if (!isLocalHost) {
    throw new Error(
      `Refusing to run tests: DATABASE_URL host "${host}" is not localhost/127.0.0.1. ` +
      `Tests must target an explicit local disposable database only.`
    );
  }

  const dbName = parsed.pathname.replace(/^\//, '').toLowerCase();
  if (!dbName.includes('test')) {
    throw new Error(
      `Refusing to run tests: database name "${dbName}" does not contain "test". ` +
      `As a naming-convention safety net, the disposable test database name must contain "test" (e.g. wfm_test).`
    );
  }
}
