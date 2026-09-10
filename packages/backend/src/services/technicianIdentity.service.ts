// v4 Requirement #12: independent technician identities.
//
// Before this, every technician in the field authenticated as ONE shared User
// row (routes/auth.ts pinned `email = TECHNICIAN_EMAIL || 'tech1@wfm.local'`),
// so every attributed action -- completion, postponement, audit entry -- pointed
// at the same identity and Administration could not tell who did what.
//
// SECURITY MODEL
// --------------
// * A technician's access code is stored ONLY as a bcrypt hash, in
//   `users.accessCodeHash`, using the same bcryptjs the `users.password` column
//   already uses. Deliberately the project's existing hashing rather than a new
//   scheme: no new secret to provision, no new failure mode, and one thing to
//   reason about.
// * The hash is never returned by any API, never logged, and cannot be reversed.
//   Administration can SET or REPLACE a code; it can never read one back. The
//   UI shows a masked "code is set" state instead (see routes/employees.ts).
// * Resolution compares the submitted code against every eligible technician's
//   hash. bcrypt hashes are salted, so there is no lookup key to index on -- but
//   this is a handful of technicians, and the comparison count is bounded by the
//   number of active technicians with a code, not by table size.
// * The comparison loop deliberately does NOT stop early in a way that leaks
//   timing (see resolveTechnicianByAccessCode).
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import prisma from '../prisma';

/** PrismaClient or a transaction client, so a check can join the caller's transaction. */
type PrismaLike = Prisma.TransactionClient | typeof prisma;

// Matches the existing department access-code format (see accessCode.service.ts)
// so technicians are not asked to remember a differently-shaped credential than
// the one the department code-entry screen has always accepted. The screen posts
// exactly four digits.
export const TECHNICIAN_CODE_FORMAT = /^[0-9]{4}$/;

// Cost factor for hashing an access code. Matches the project's existing bcrypt
// usage for passwords. Note this is a 4-digit code (10,000 possibilities), so
// the hash's value is limited to protecting the code at rest if the database
// leaks -- the real defence against online guessing is the dedicated technician
// code-login rate limiter in app.ts (10 FAILED attempts / 15 min per IP, layered
// on top of the generic 50/15min auth limiter). Called out explicitly rather
// than left implied, because it is the honest security boundary of a 4-digit
// credential kept at 4 digits by deliberate operational choice (decision D8).
const BCRYPT_ROUNDS = 10;

export interface ResolvedTechnician {
  id: string;
  name: string;
  email: string;
  role: string;
  // Needed so the login route can stamp the token's `sv` claim (v4 decision D9)
  // without a second query for the account it has just resolved.
  sessionVersion: number;
}

/**
 * Every technician who is allowed to authenticate with a personal code:
 * active, TECHNICIAN role, and has actually had a code set.
 */
async function eligibleTechnicians() {
  return prisma.user.findMany({
    where: { role: 'TECHNICIAN', isActive: true, accessCodeHash: { not: null } },
    select: { id: true, name: true, email: true, role: true, sessionVersion: true, accessCodeHash: true },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Resolves a submitted access code to exactly one technician, or null.
 *
 * Returns null both when no technician matches and when no technician has a code
 * configured at all, so the caller cannot distinguish "wrong code" from "feature
 * not in use yet" -- the login route turns both into the same generic 401.
 *
 * The loop intentionally evaluates EVERY eligible technician's hash rather than
 * returning on first match. Short-circuiting would make a code belonging to the
 * first-created technician measurably faster to verify than one belonging to the
 * last, which over repeated attempts leaks which position in the list a guessed
 * code occupies. The cost is a few extra bcrypt comparisons on a list of about
 * three people.
 */
export async function resolveTechnicianByAccessCode(code: string): Promise<ResolvedTechnician | null> {
  if (!TECHNICIAN_CODE_FORMAT.test(code)) return null;

  const technicians = await eligibleTechnicians();
  let match: ResolvedTechnician | null = null;

  for (const tech of technicians) {
    // accessCodeHash is non-null by the query filter above; the guard keeps
    // TypeScript honest without changing behaviour.
    const ok = tech.accessCodeHash ? await bcrypt.compare(code, tech.accessCodeHash) : false;
    if (ok && !match) {
      match = { id: tech.id, name: tech.name, email: tech.email, role: tech.role, sessionVersion: tech.sessionVersion };
    }
  }

  return match;
}

/**
 * Hashes an access code for storage. The plaintext is never persisted, returned
 * or logged anywhere -- this is the only place it is handled at all, and it does
 * not leave this function.
 */
export async function hashAccessCode(code: string): Promise<string> {
  return bcrypt.hash(code, BCRYPT_ROUNDS);
}

/**
 * Whether any OTHER technician already uses this code.
 *
 * Uniqueness cannot be a database constraint here: bcrypt salts every hash, so
 * two identical codes produce two different hashes and no unique index could see
 * the collision. It has to be checked at set-time instead -- and it genuinely
 * matters, because two technicians sharing a code would make
 * resolveTechnicianByAccessCode ambiguous, silently attributing one technician's
 * work to the other.
 *
 * NOTE: on its own this is a plain read and is therefore RACY. It is exported
 * only for read-only callers and tests. Every path that actually ASSIGNS a code
 * must go through assignTechnicianAccessCode() below, which performs the same
 * check and the write inside one serializable transaction.
 *
 * `excludeUserId` lets a technician be re-assigned their own existing code
 * without tripping the check.
 */
export async function isAccessCodeTaken(code: string, excludeUserId?: string): Promise<boolean> {
  return codeCollides(prisma, code, excludeUserId);
}

/**
 * The uniqueness check itself, runnable against a transaction client.
 *
 * IMPORTANT -- the `where` deliberately selects EVERY technician row, not just
 * those that already have a code, even though only non-null hashes can collide.
 *
 * That is what makes SERIALIZABLE actually work here. PostgreSQL's SSI detects
 * conflicts through predicate locks on what a transaction READ. If this read
 * were narrowed to `accessCodeHash IS NOT NULL`, then two concurrent assignments
 * to two technicians who both currently have NO code would each write a row that
 * sat OUTSIDE the other's read predicate -- no read-write dependency, no cycle,
 * no serialization failure, and both writes would commit. Reading all technician
 * rows puts every row either transaction might write inside both predicates, so
 * the dangerous structure is visible and one transaction is aborted.
 */
async function codeCollides(client: PrismaLike, code: string, excludeUserId?: string): Promise<boolean> {
  const technicians = await client.user.findMany({
    where: {
      role: 'TECHNICIAN',
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
    select: { accessCodeHash: true },
  });

  for (const tech of technicians) {
    if (tech.accessCodeHash && (await bcrypt.compare(code, tech.accessCodeHash))) return true;
  }
  return false;
}

export type AssignAccessCodeResult =
  | { ok: true }
  | { ok: false; reason: 'CODE_TAKEN' }
  | { ok: false; reason: 'NOT_FOUND' }
  | { ok: false; reason: 'CONTENTION' };

/** Prisma raises P2034 for a transaction write conflict / deadlock, which is how a PostgreSQL 40001 serialization failure surfaces. */
function isSerializationFailure(e: any): boolean {
  return e?.code === 'P2034' || e?.meta?.code === '40001' || /could not serialize|deadlock detected/i.test(String(e?.message ?? ''));
}

const MAX_ASSIGN_ATTEMPTS = 3;

/**
 * The ONE concurrency-safe way to assign a technician access code.
 *
 * Used by BOTH assignment paths -- initial assignment at employee creation and a
 * later reset/change -- so there is no safe path and race-prone path.
 *
 * S2 root cause: the previous flow read every hash, bcrypt-compared, and then
 * wrote in a SEPARATE statement. Two concurrent Admin requests could both
 * observe "not taken" and both commit, giving two technicians the same 4-digit
 * code. Login resolves deterministically to the first-created match, so from
 * then on one technician's own code silently authenticates them AS someone else
 * -- every completion, postponement and audit entry permanently misattributed,
 * with no error at any point. That is an integrity break in exactly the
 * attribution model this phase exists to build.
 *
 * The check and the write now happen inside ONE serializable transaction, so the
 * database itself rejects the interleaving rather than the application hoping to
 * win the race.
 *
 * Deliberately NOT used here: process-memory locks (useless across restarts and
 * multiple instances), Redis (a whole dependency for one check), a separate
 * table, or any reversible/deterministic representation of the code (which would
 * weaken at-rest protection to buy an index).
 *
 * `bumpSessionVersion` is set for a RESET so existing sessions established with
 * the old credential die with it; it is left false for a first assignment, where
 * there is no prior session to revoke.
 *
 * No Socket.IO emission and no audit write happen in here -- the caller does
 * those after the commit, so the transaction never stays open across network I/O.
 */
export async function assignTechnicianAccessCode(opts: {
  technicianId: string;
  code: string;
  bumpSessionVersion: boolean;
}): Promise<AssignAccessCodeResult> {
  const { technicianId, code, bumpSessionVersion } = opts;

  for (let attempt = 1; attempt <= MAX_ASSIGN_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Scoped to TECHNICIAN inside the transaction too, so this can never
          // be used to set a code on an ADMIN/SCHEDULING account.
          const target = await tx.user.findFirst({
            where: { id: technicianId, role: 'TECHNICIAN' },
            select: { id: true },
          });
          if (!target) return { ok: false, reason: 'NOT_FOUND' } as const;

          if (await codeCollides(tx, code, technicianId)) {
            return { ok: false, reason: 'CODE_TAKEN' } as const;
          }

          await tx.user.update({
            where: { id: technicianId },
            data: {
              accessCodeHash: await hashAccessCode(code),
              accessCodeSetAt: new Date(),
              ...(bumpSessionVersion ? { sessionVersion: { increment: 1 } } : {}),
            },
          });

          return { ok: true } as const;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          // Generous relative to the default: this transaction performs bcrypt
          // comparisons (one per technician holding a code) plus one bcrypt hash,
          // which is deliberately slow work.
          timeout: 20_000,
          maxWait: 10_000,
        }
      );
    } catch (e: any) {
      if (isSerializationFailure(e) && attempt < MAX_ASSIGN_ATTEMPTS) {
        // Bounded retry with a small jittered backoff. A serialization failure
        // means the database prevented exactly the race this exists to stop, so
        // retrying is correct -- the retry re-reads and will see the committed
        // winner.
        await new Promise((r) => setTimeout(r, 25 * attempt + Math.random() * 25));
        continue;
      }
      if (isSerializationFailure(e)) {
        // Never fall back to a non-transactional write. Refusing is safe;
        // writing an ambiguous credential is not.
        return { ok: false, reason: 'CONTENTION' };
      }
      throw e;
    }
  }

  return { ok: false, reason: 'CONTENTION' };
}

/**
 * The email that identifies the LEGACY SHARED technician account.
 *
 * This is not a new assumption and not a name/UI match: it is the project's
 * pre-existing architectural definition of the shared identity. routes/auth.ts
 * has always resolved the shared department code to exactly this account, and
 * the env var exists precisely so a deployment can point at a different one.
 * Centralised here so there is ONE definition rather than a literal repeated at
 * each site that needs to reason about it.
 */
export function sharedTechnicianEmail(): string {
  return process.env.TECHNICIAN_EMAIL || 'tech1@wfm.local';
}

/**
 * The legacy shared technician account's id, or null if it does not exist.
 *
 * Uses the same lookup the shared-code login path uses, so "which account is the
 * shared one" can never be answered two different ways.
 */
export async function findSharedTechnicianAccountId(client: PrismaLike = prisma): Promise<string | null> {
  const user = await client.user.findFirst({
    where: { role: 'TECHNICIAN', email: sharedTechnicianEmail() },
    select: { id: true },
  });
  return user?.id ?? null;
}

/**
 * SystemConfig key recording that the legacy shared technician login has been
 * permanently retired.
 *
 * Stored in the existing generic key/value SystemConfig table -- no schema
 * change and no new table, because that is exactly what SystemConfig is for
 * (it already holds the department access codes themselves).
 */
export const SHARED_LOGIN_RETIRED_KEY = 'TECHNICIAN_SHARED_LOGIN_RETIRED';

/**
 * Reads the flag and lets any error PROPAGATE.
 *
 * Used by status reads (the Employees migration panel, the Access Codes page),
 * where guessing is worse than erroring: reporting a false "Retired" would hide
 * the cutover control and hide the shared-code rotation form while the shared
 * code is in fact still live and possibly needs rotating.
 */
export async function readSharedLoginRetirementFlag(): Promise<boolean> {
  const row = await prisma.systemConfig.findUnique({ where: { key: SHARED_LOGIN_RETIRED_KEY } });
  return row?.value === 'true';
}

/**
 * Whether the one-way cutover has already been recorded, FAILING CLOSED.
 *
 * Used on the LOGIN path only. There, a database blip must not be allowed to
 * hand out the shared unattributed identity, so an unreadable flag is treated as
 * "retired". That trade is correct for authentication and wrong for a status
 * display -- hence the separate reader above.
 */
export async function isSharedLoginRetirementRecorded(): Promise<boolean> {
  try {
    return await readSharedLoginRetirementFlag();
  } catch (e: any) {
    console.error('[technician-identity] Could not read shared-login retirement flag; failing closed:', e?.message || e);
    return true;
  }
}

/**
 * Whether an account is the LEGACY SHARED one.
 *
 * The shared account is not an employee identity -- it is a migration bridge
 * that happens to be stored in the same table. Every "individual technician"
 * query excludes it through this, so it can never be counted as an employee,
 * as a technician awaiting code setup, or as cutover-relevant roster.
 */
export async function isSharedTechnicianAccount(userId: string): Promise<boolean> {
  const sharedId = await findSharedTechnicianAccountId();
  return sharedId !== null && sharedId === userId;
}

/**
 * Prisma `where` fragment selecting REAL individual technician employees only.
 *
 * The exclusion is expressed as `NOT: { id }` rather than `id: { not }` on
 * purpose: callers combine this with their own `id` filter, and an `id` key here
 * would be silently overwritten by theirs -- which would quietly re-expose the
 * legacy account to exactly the management routes that must never reach it.
 * `NOT` cannot collide with a caller's `id`.
 */
export async function individualTechnicianWhere(
  client: PrismaLike = prisma
): Promise<{ role: 'TECHNICIAN'; NOT?: { id: string } }> {
  const sharedId = await findSharedTechnicianAccountId(client);
  return sharedId ? { role: 'TECHNICIAN', NOT: { id: sharedId } } : { role: 'TECHNICIAN' };
}

export type CutoverSerializedResult<T> =
  | { ok: true; value: T; sharedLoginRetired: boolean }
  | { ok: false; reason: 'CONTENTION' };

/**
 * Runs a roster mutation inside the SAME serializable conflict boundary as
 * completeTechnicianCutover().
 *
 * WHY THIS EXISTS -- and why simply marking the mutation SERIALIZABLE is not
 * enough. PostgreSQL's SSI aborts a transaction only when it can see a
 * read-write dependency CYCLE between transactions that are both serializable.
 * completeTechnicianCutover() reads the technician roster and writes the
 * retirement flag. A technician INSERT that merely runs at SERIALIZABLE without
 * reading anything the cutover writes contributes only one edge:
 *
 *     cutover --(read users, then insert)--> creation
 *
 * One edge is not a cycle, so both transactions commit happily and the cutover
 * retires the shared bridge from a snapshot that never contained the technician
 * who committed alongside it. That technician then has no personal code and no
 * shared code -- permanently unable to sign in. That is precisely the lockout
 * the explicit-cutover design (option A) exists to prevent, just relocated into
 * a narrower window.
 *
 * The missing edge is supplied here by READING the retirement flag with the
 * caller's transaction client before the mutation runs. The flag row is exactly
 * what the cutover WRITES, so the graph closes:
 *
 *     cutover  --(reads users, creation inserts one)-->  creation
 *     creation --(reads the flag, cutover writes it)-->  cutover
 *
 * PostgreSQL now has a cycle, aborts one side with 40001, and the bounded retry
 * below re-runs it against the committed winner. Both surviving interleavings
 * are correct:
 *
 *   A. the mutation commits first  -> the cutover retries, now SEES the codeless
 *      technician, and is refused as not eligible.
 *   B. the cutover commits first   -> the mutation retries and commits AFTER
 *      retirement, and `sharedLoginRetired` comes back true so the caller can
 *      tell the administrator this person cannot sign in until they are given a
 *      personal code. The bridge stays retired either way.
 *
 * The read is not a formality and is not discarded: its value is the caller's
 * witness of which side of the cutover it was serialized on.
 *
 * The flag row frequently does not exist yet (nothing writes it before the
 * cutover). That is fine -- a btree index probe for a missing key still takes a
 * predicate lock covering the gap, so the cutover's INSERT of that key conflicts
 * exactly as an UPDATE of an existing row would.
 *
 * Deliberately not used: advisory locks, a lock table, Redis, or process-memory
 * locks. The invariant is enforceable with the isolation level the codebase
 * already relies on for S2, and nothing weaker than the database can enforce it
 * across multiple backend instances anyway.
 *
 * `work` must use ONLY the `tx` client it is handed. Reaching for the outer
 * `prisma` singleton from inside would run that statement in its own separate
 * transaction, outside the boundary, and silently reintroduce the race.
 */
export async function runSerializedAgainstCutover<T>(
  work: (tx: Prisma.TransactionClient, sharedLoginRetired: boolean) => Promise<T>,
  timeoutMs = 15_000
): Promise<CutoverSerializedResult<T>> {
  for (let attempt = 1; attempt <= MAX_ASSIGN_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const flag = await tx.systemConfig.findUnique({ where: { key: SHARED_LOGIN_RETIRED_KEY } });
          const sharedLoginRetired = flag?.value === 'true';
          const value = await work(tx, sharedLoginRetired);
          return { ok: true as const, value, sharedLoginRetired };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: timeoutMs, maxWait: 10_000 }
      );
    } catch (e: any) {
      if (isSerializationFailure(e) && attempt < MAX_ASSIGN_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 25 * attempt + Math.random() * 25));
        continue;
      }
      if (isSerializationFailure(e)) return { ok: false, reason: 'CONTENTION' };
      throw e;
    }
  }

  return { ok: false, reason: 'CONTENTION' };
}

export type CutoverEligibility =
  | { eligible: true }
  | { eligible: false; reason: 'NO_INDIVIDUAL_TECHNICIANS' | 'TECHNICIANS_WITHOUT_CODE'; missingCount: number };

/**
 * Whether Administration may complete the migration right now.
 *
 * Deliberately does NOT infer an expected headcount -- the administrator decides
 * when the roster is complete. This only checks that what exists is actually
 * usable: at least one real active technician, and none of them left without a
 * personal code (which would lock that person out the moment the bridge closes).
 */
export async function getCutoverEligibility(): Promise<CutoverEligibility> {
  const base = await individualTechnicianWhere();
  const active = await prisma.user.findMany({
    where: { ...base, isActive: true },
    select: { accessCodeHash: true },
  });

  if (active.length === 0) return { eligible: false, reason: 'NO_INDIVIDUAL_TECHNICIANS', missingCount: 0 };

  const missing = active.filter((t) => t.accessCodeHash === null).length;
  if (missing > 0) return { eligible: false, reason: 'TECHNICIANS_WITHOUT_CODE', missingCount: missing };

  return { eligible: true };
}

export type CutoverResult =
  | { ok: true; alreadyRetired: boolean }
  | { ok: false; reason: 'NO_INDIVIDUAL_TECHNICIANS' | 'TECHNICIANS_WITHOUT_CODE' | 'CONTENTION'; missingCount: number };

/**
 * Completes the technician identity migration. THE ONLY way the retirement flag
 * is ever set.
 *
 * Explicitly administrative (approved option A). An earlier version derived
 * cutover from the roster and wrote the flag from inside the LOGIN path, which
 * had a serious flaw: during migration the real technicians have no individual
 * accounts yet -- they are all still on the shared code -- so an administrator
 * adding a single pilot technician with a code satisfied "every individual
 * technician has a code" and permanently locked everyone else out, with no
 * confirmation and no way back. The roster cannot express "setup is finished";
 * only a person can.
 *
 * Idempotent: calling it again when already retired reports the current state
 * rather than doing anything. There is deliberately no inverse -- nothing in the
 * API or UI can set this flag back to false.
 */
export async function completeTechnicianCutover(): Promise<CutoverResult> {
  if (await isSharedLoginRetirementRecorded()) {
    return { ok: true, alreadyRetired: true };
  }

  const eligibility = await getCutoverEligibility();
  if (!eligibility.eligible) {
    return { ok: false, reason: eligibility.reason, missingCount: eligibility.missingCount };
  }

  // This is one half of a pair. The other half is runSerializedAgainstCutover()
  // above, which every roster mutation that can create an ACTIVE technician
  // WITHOUT a code runs inside; see the long comment there for why serializable
  // isolation on this side alone is not sufficient.
  //
  // The eligibility re-check and the write must be ONE serializable unit --
  // structurally the same read-then-write race as S2, and with the same kind of
  // consequence. At READ COMMITTED a technician created (or reactivated) without
  // a code could commit between this transaction's read and its write, so the
  // bridge would close permanently while that person had no way to sign in at
  // all. Every read below therefore goes through `tx`, including the
  // shared-account lookup, so the whole check shares one snapshot.
  for (let attempt = 1; attempt <= MAX_ASSIGN_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const existing = await tx.systemConfig.findUnique({ where: { key: SHARED_LOGIN_RETIRED_KEY } });
          if (existing?.value === 'true') return { ok: true, alreadyRetired: true } as const;

          const sharedId = await findSharedTechnicianAccountId(tx);
          const active = await tx.user.findMany({
            where: {
              role: 'TECHNICIAN',
              isActive: true,
              ...(sharedId ? { NOT: { id: sharedId } } : {}),
            },
            select: { accessCodeHash: true },
          });
          if (active.length === 0) {
            return { ok: false, reason: 'NO_INDIVIDUAL_TECHNICIANS', missingCount: 0 } as const;
          }
          const missing = active.filter((t) => t.accessCodeHash === null).length;
          if (missing > 0) {
            return { ok: false, reason: 'TECHNICIANS_WITHOUT_CODE', missingCount: missing } as const;
          }

          await tx.systemConfig.upsert({
            where: { key: SHARED_LOGIN_RETIRED_KEY },
            update: { value: 'true' },
            create: { key: SHARED_LOGIN_RETIRED_KEY, value: 'true' },
          });
          return { ok: true, alreadyRetired: false } as const;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000, maxWait: 10_000 }
      );
    } catch (e: any) {
      if (isSerializationFailure(e) && attempt < MAX_ASSIGN_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 25 * attempt + Math.random() * 25));
        continue;
      }
      // Contention exhausted: refuse rather than retire on a stale read. Cutover
      // is irreversible, so "try again" is always the safer answer.
      //
      // Reported as its own CONTENTION reason, matching assignTechnicianAccessCode
      // and runSerializedAgainstCutover, so the route can answer 503 "try again".
      // It previously rethrew here, which surfaced as an opaque 500 -- and this
      // path is no longer rare: now that every technician create/rename/
      // reactivate is a serializable transaction that deliberately conflicts with
      // this one, exhausting three aborts is a normal contention outcome rather
      // than an internal error. Reporting it as a server fault would tell an
      // administrator something is broken when the correct advice is to retry.
      if (isSerializationFailure(e)) return { ok: false, reason: 'CONTENTION', missingCount: 0 };
      throw e;
    }
  }

  return { ok: false, reason: 'CONTENTION', missingCount: 0 };
}

/**
 * Whether the legacy shared department code must be REFUSED.
 *
 * A PURE READ. Login must never mutate configuration: an authentication attempt
 * triggering an irreversible operational change is exactly the defect that made
 * the previous automatic cutover unsafe.
 */
export async function shouldRefuseSharedTechnicianCode(): Promise<boolean> {
  return isSharedLoginRetirementRecorded();
}
