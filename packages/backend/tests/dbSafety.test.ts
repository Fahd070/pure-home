// Lightweight, no-database-required tests for the production-safety guard shared by
// the permanent test suite and the backup-restore verification script (Issue #8).
// Deliberately not a full unit-test suite around shell commands -- just the handful
// of scenarios that must never be allowed to slip through.
import { describe, it, expect } from 'vitest';
import path from 'path';
import { execFileSync } from 'child_process';
import { assertSafeTestDatabaseUrl } from './helpers/dbSafety';

describe('dbSafety: assertSafeTestDatabaseUrl', () => {
  it('rejects a Supabase production-looking host', () => {
    expect(() => assertSafeTestDatabaseUrl('postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/postgres')).toThrow();
  });

  it('rejects a Render-hosted host', () => {
    expect(() => assertSafeTestDatabaseUrl('postgresql://user:pw@wfm-db.onrender.com:5432/wfm')).toThrow();
  });

  it('rejects a database name that does not contain "test"', () => {
    expect(() => assertSafeTestDatabaseUrl('postgresql://postgres:test@localhost:5432/wfm_production')).toThrow();
  });

  it('accepts a valid local restore_test database name', () => {
    expect(() => assertSafeTestDatabaseUrl('postgresql://postgres:test@localhost:5432/wfm_restore_test')).not.toThrow();
  });

  it('accepts a valid local wfm_test database name', () => {
    expect(() => assertSafeTestDatabaseUrl('postgresql://postgres:test@127.0.0.1:5432/wfm_test')).not.toThrow();
  });

  it('rejects an empty/unset URL', () => {
    expect(() => assertSafeTestDatabaseUrl(undefined)).toThrow();
  });
});

describe('backup:verify script -- fails safely without ever touching a database', () => {
  const backendDir = path.join(__dirname, '..');

  // Windows can only spawn npx's .cmd shim through a shell (a plain execFileSync
  // without shell:true throws EINVAL for .cmd files on this platform). shell:true
  // normally warns about unescaped args, but every argument here is a fixed literal
  // owned by this test file -- never external/untrusted input -- so that warning
  // doesn't apply to this specific, fully-controlled invocation.
  function runScript(args: string[], env: Record<string, string>) {
    try {
      execFileSync('npx', ['ts-node', 'scripts/verify-backup-restore.ts', ...args], {
        cwd: backendDir,
        env: { ...process.env, ...env },
        encoding: 'utf-8',
        stdio: 'pipe',
        shell: true,
      });
      return { code: 0, output: '' };
    } catch (e: any) {
      return { code: e.status ?? 1, output: `${e.stdout || ''}${e.stderr || ''}` };
    }
  }

  it('rejects a Supabase-looking RESTORE_TEST_DATABASE_URL before touching any database', () => {
    const result = runScript(['/does-not-matter.dump'], {
      RESTORE_TEST_DATABASE_URL: 'postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/postgres',
    });
    expect(result.code).not.toBe(0);
    expect(result.output).toMatch(/safety check/i);
  }, 20000);

  it('rejects a missing backup file', () => {
    const result = runScript(['/definitely/does/not/exist.dump'], {
      RESTORE_TEST_DATABASE_URL: 'postgresql://postgres:test@localhost:59999/wfm_restore_test',
    });
    expect(result.code).not.toBe(0);
    expect(result.output).toMatch(/Backup file not found/i);
  }, 20000);
});
