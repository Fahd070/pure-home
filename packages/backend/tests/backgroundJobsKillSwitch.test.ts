// Regression tests for the ENABLE_BACKGROUND_JOBS kill switch (src/index.ts),
// which lets a standby/test backend instance share the same Production
// database as the real instance without running a duplicate notification
// cron. Deliberately does NOT import src/index.ts directly -- that module
// binds a real TCP port and connects to the database as a side effect of
// being imported, which would either fail locally (no DB reachable) or, in
// CI, actually start a live server/DB connection for a unit test, neither of
// which is appropriate here. Instead: the exact gating expression is
// extracted from the real source file by regex and evaluated directly (so a
// future edit to the real expression is what these tests actually exercise,
// not a hand-copied duplicate that could silently drift out of sync), and
// the surrounding startup structure is verified with additional source-level
// assertions. This is the "smallest existing test pattern" already used
// elsewhere in this suite for files that can't safely be imported/rendered.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const indexSrc = fs.readFileSync(path.resolve(__dirname, '../src/index.ts'), 'utf-8');

function extractBackgroundJobsExpression(): string {
  const match = indexSrc.match(/const backgroundJobsEnabled = (process\.env\.ENABLE_BACKGROUND_JOBS\?\.toLowerCase\(\) !== 'false');/);
  if (!match) throw new Error('Could not find the backgroundJobsEnabled expression in src/index.ts -- source may have changed');
  return match[1];
}

function evalBackgroundJobsEnabled(envValue: string | undefined): boolean {
  const expr = extractBackgroundJobsExpression();
  const prev = process.env.ENABLE_BACKGROUND_JOBS;
  if (envValue === undefined) delete process.env.ENABLE_BACKGROUND_JOBS;
  else process.env.ENABLE_BACKGROUND_JOBS = envValue;
  try {
    // eslint-disable-next-line no-new-func -- evaluating the real extracted
    // source expression, not arbitrary/untrusted input.
    return new Function(`return (${expr});`)();
  } finally {
    if (prev === undefined) delete process.env.ENABLE_BACKGROUND_JOBS;
    else process.env.ENABLE_BACKGROUND_JOBS = prev;
  }
}

describe('ENABLE_BACKGROUND_JOBS kill switch: parsing semantics (real source expression)', () => {
  it('1. env absent -> background jobs remain enabled (preserves existing Production Oregon behavior exactly)', () => {
    expect(evalBackgroundJobsEnabled(undefined)).toBe(true);
  });

  it('2. env=true -> enabled', () => {
    expect(evalBackgroundJobsEnabled('true')).toBe(true);
  });

  it('3. env=false -> disabled', () => {
    expect(evalBackgroundJobsEnabled('false')).toBe(false);
  });

  it('case-insensitive: "False"/"FALSE" also disable', () => {
    expect(evalBackgroundJobsEnabled('False')).toBe(false);
    expect(evalBackgroundJobsEnabled('FALSE')).toBe(false);
  });

  it('any value other than "false" (case-insensitive) leaves jobs enabled -- fails safe toward existing behavior', () => {
    expect(evalBackgroundJobsEnabled('nope')).toBe(true);
    expect(evalBackgroundJobsEnabled('0')).toBe(true);
    expect(evalBackgroundJobsEnabled('')).toBe(true);
  });
});

describe('src/index.ts: only startNotificationCron() is gated, nothing else', () => {
  it('4. the cron call itself is conditional; DB connection, Socket.IO init, schema check, and server.listen are all unconditional (disabled jobs cannot prevent backend startup)', () => {
    expect(indexSrc).toMatch(/const notificationCronTask = backgroundJobsEnabled \? startNotificationCron\(\) : null;/);
    // initSocket, verifySchemaIsMigrated, and server.listen all appear as
    // plain top-level statements, not inside any conditional block guarding
    // the rest of startup.
    expect(indexSrc).toMatch(/const io = initSocket\(server\);/);
    expect(indexSrc).toMatch(/^verifySchemaIsMigrated\(\);/m);
    expect(indexSrc).toMatch(/^server\.listen\(PORT, BIND_HOST/m);
    expect(indexSrc).not.toMatch(/if\s*\(backgroundJobsEnabled\)/);
    expect(indexSrc).not.toMatch(/if\s*\(!backgroundJobsEnabled\)/);
  });

  it('graceful shutdown safely no-ops stopCron when the cron was never started (null task)', () => {
    expect(indexSrc).toMatch(/stopCron:\s*\(\)\s*=>\s*notificationCronTask\?\.stop\(\)/);
  });

  it('logs a clear, non-secret ENABLED/DISABLED status at startup', () => {
    expect(indexSrc).toMatch(/console\.log\(`  Background jobs: \$\{backgroundJobsEnabled \? 'ENABLED' : 'DISABLED'\}`\);/);
    // Never logs the raw env value or any secret.
    expect(indexSrc).not.toMatch(/console\.log\([^)]*ENABLE_BACKGROUND_JOBS[^)]*\)/);
  });
});

describe('services/notification.service.ts: job logic, schedule, and frequency unchanged', () => {
  const notificationSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/services/notification.service.ts'), 'utf-8'
  );

  it('5. hourly cron schedule and post-boot delay are byte-identical to before -- no frequency change', () => {
    expect(notificationSrc).toMatch(/cron\.schedule\('0 \* \* \* \*', generateReminders\);/);
    expect(notificationSrc).toMatch(/setTimeout\(generateReminders, 3000\);/);
  });

  it('startNotificationCron() and generateReminders() signatures/exports are unchanged', () => {
    expect(notificationSrc).toMatch(/export function startNotificationCron\(\)/);
    expect(notificationSrc).toMatch(/export async function generateReminders\(\)/);
  });

  it('the kill switch lives only in src/index.ts, not duplicated or re-implemented inside the service itself', () => {
    expect(notificationSrc).not.toMatch(/ENABLE_BACKGROUND_JOBS/);
  });
});

describe('Documentation: ENABLE_BACKGROUND_JOBS documented in .env.example', () => {
  const envExampleSrc = fs.readFileSync(path.resolve(__dirname, '../.env.example'), 'utf-8');

  it('documents the variable, its default, and when to set it false', () => {
    expect(envExampleSrc).toMatch(/ENABLE_BACKGROUND_JOBS=true/);
    expect(envExampleSrc).toMatch(/defaults? .*enabled/i);
    expect(envExampleSrc).toMatch(/standby|test backend instance/i);
  });
});
