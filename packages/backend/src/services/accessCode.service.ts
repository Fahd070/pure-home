import prisma from '../prisma';

export type Dept = 'admin' | 'scheduling' | 'technician';

export const ACCESS_CODE_DB_KEYS: Record<Dept, string> = {
  admin: 'ACCESS_CODE_ADMIN',
  scheduling: 'ACCESS_CODE_SCHEDULING',
  technician: 'ACCESS_CODE_TECHNICIAN',
};

const CODE_FORMAT = /^[0-9]{4}$/;

function envCode(dept: Dept): string | undefined {
  if (dept === 'admin')      return process.env.ADMIN_CODE;
  if (dept === 'scheduling') return process.env.SCHEDULING_CODE;
  return                            process.env.TECHNICIAN_CODE;
}

/**
 * Resolves the configured access code for ONE department: a system_configs
 * DB row takes precedence, then the department's env var if present (env
 * support is optional and only relevant to deployments that use it — not
 * required in this project's production Render environment). Either source
 * must match ^[0-9]{4}$ to be accepted. No literal fallback — returns
 * undefined ("not configured") if neither source yields a valid code.
 */
export async function resolveAccessCode(dept: Dept): Promise<string | undefined> {
  let dbValue: string | undefined;
  try {
    const record = await prisma.systemConfig.findUnique({ where: { key: ACCESS_CODE_DB_KEYS[dept] } });
    dbValue = record?.value;
  } catch {
    console.error(`[access-code] Database lookup failed for department "${dept}".`);
  }

  if (dbValue) {
    if (CODE_FORMAT.test(dbValue)) return dbValue;
    console.warn(`[access-code] Database value for department "${dept}" is not a valid 4-digit code; ignoring it.`);
  }

  const env = envCode(dept);
  if (env) {
    if (CODE_FORMAT.test(env)) return env;
    console.warn(`[access-code] Environment value for department "${dept}" is not a valid 4-digit code; ignoring it.`);
  }

  console.warn(`[access-code] No valid access code configured for department "${dept}". Code-login refused until configured.`);
  return undefined;
}
