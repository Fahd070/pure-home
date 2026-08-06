// Shared, idempotent test fixtures. Every function here is upsert-based so calling it
// from multiple test files' beforeAll hooks (run sequentially, per vitest.config.ts) is
// always safe and never depends on execution order.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../../src/prisma';

export const TEST_PASSWORD = 'Test-Password-12345!';

// technician1's email intentionally matches the app's own default TECHNICIAN_EMAIL
// fallback ('tech1@wfm.local', see src/routes/auth.ts) so department code-login for
// "technician" resolves to this fixture without needing a special env var in tests.
export const TEST_USER_DEFS = {
  admin:       { email: 'admin@test.local',     name: 'Test Admin',        role: 'ADMIN' as const },
  scheduling:  { email: 'scheduling@test.local', name: 'Test Scheduling',   role: 'SCHEDULING' as const },
  technician:  { email: 'tech1@wfm.local',       name: 'Test Technician 1', role: 'TECHNICIAN' as const },
  // Second, disposable technician used purely for authorization/data-isolation tests.
  // Exists only in this disposable test database, never production.
  technician2: { email: 'tech2@wfm.local',       name: 'Test Technician 2', role: 'TECHNICIAN' as const },
};

export type TestUserKey = keyof typeof TEST_USER_DEFS;
export type TestUsers = Record<TestUserKey, { id: string; email: string; role: string }>;

let cachedHash: string | undefined;

export async function ensureTestUsers(): Promise<TestUsers> {
  // Low bcrypt cost factor is a test-speed optimization only; bcrypt.compare() in the
  // real login route works identically regardless of the cost factor embedded in the hash.
  if (!cachedHash) cachedHash = await bcrypt.hash(TEST_PASSWORD, 4);

  const result = {} as TestUsers;
  for (const key of Object.keys(TEST_USER_DEFS) as TestUserKey[]) {
    const def = TEST_USER_DEFS[key];
    const user = await prisma.user.upsert({
      where: { email: def.email },
      update: {},
      create: { name: def.name, email: def.email, password: cachedHash, role: def.role as any },
    });
    result[key] = { id: user.id, email: user.email, role: user.role };
  }
  return result;
}

function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET must be set in the test environment (see tests/README.md).');
  }
  return secret;
}

// Mints a JWT with the exact same shape and secret the application's own auth routes
// use (see src/routes/auth.ts), so it is indistinguishable from a real login token.
export function signTestToken(userId: string, role: string): string {
  return jwt.sign({ userId, role }, requireJwtSecret(), { expiresIn: '8h' });
}

// Disposable test-only department access codes. Deliberately NOT 9012/9013/9014
// (the old hardcoded production fallback removed in a prior fix) or any other
// production-meaningful value -- freshly chosen constants scoped to this test suite.
export const TEST_ACCESS_CODES = {
  admin: '5001',
  scheduling: '5002',
  technician: '5003',
};

const ACCESS_CODE_DB_KEYS: Record<keyof typeof TEST_ACCESS_CODES, string> = {
  admin: 'ACCESS_CODE_ADMIN',
  scheduling: 'ACCESS_CODE_SCHEDULING',
  technician: 'ACCESS_CODE_TECHNICIAN',
};

export async function ensureTestAccessCodes(): Promise<void> {
  const now = new Date();
  for (const dept of Object.keys(TEST_ACCESS_CODES) as (keyof typeof TEST_ACCESS_CODES)[]) {
    const key = ACCESS_CODE_DB_KEYS[dept];
    const value = TEST_ACCESS_CODES[dept];
    await prisma.systemConfig.upsert({
      where: { key },
      update: { value, updatedAt: now },
      create: { key, value, updatedAt: now, createdAt: now },
    });
  }
}

export function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Matches customers.ts's ^05\d{8}$ phone validation.
export function testPhone(): string {
  let digits = '';
  for (let i = 0; i < 8; i++) digits += Math.floor(Math.random() * 10);
  return `05${digits}`;
}
