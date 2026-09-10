// v4 Requirement #12: Administration -> Employees.
//
// Manages TECHNICIAN employee accounts against the SAME `users` rows that
// authentication, appointment assignment and audit attribution already use.
// There is deliberately no separate employee/credential store: a second list
// would immediately drift from the first, and "which technician is this?" would
// have two answers.
//
// The Administration Access Codes page is a second view onto these same records
// and calls these same endpoints (see routes/config.ts, which exposes the
// technician roster by delegating here rather than re-querying).
//
// SECURITY
// --------
// * Every route is ADMIN-only. Scheduling and Technicians are both excluded --
//   a technician must never be able to manage technician credentials, including
//   their own.
// * `accessCodeHash` is never selected into any response. The API reports only
//   whether a code is set (`hasAccessCode`) and when it was last set.
// * Submitted codes are never logged, never echoed back, and never stored in
//   plaintext.
// * Role is forced to TECHNICIAN on create and can never be changed here, so
//   this page cannot be used to mint an ADMIN account.
import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import prisma from '../prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { writeAudit } from '../services/audit.service';
import { emitToRole, disconnectUserSockets } from '../socket';
import { SOCKET_EVENTS, SOCKET_ROOMS } from '../constants';
import {
  TECHNICIAN_CODE_FORMAT,
  assignTechnicianAccessCode,
  AssignAccessCodeResult,
  individualTechnicianWhere,
  readSharedLoginRetirementFlag,
  getCutoverEligibility,
  completeTechnicianCutover,
  runSerializedAgainstCutover,
} from '../services/technicianIdentity.service';

const router = Router();
router.use(authenticate);
// Applied at the router level rather than per-route so a future route added to
// this file cannot accidentally ship without an authorization check.
router.use(requireRole('ADMIN'));

// Name only -- no email field. Technicians authenticate by access code, never by
// email, so asking Administration to invent a unique email address for each one
// would be busywork with a uniqueness constraint attached. An internal address is
// generated below instead.
const createSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  // Optional at create time: an employee record can exist before their code is
  // handed to them.
  accessCode: z.string().regex(TECHNICIAN_CODE_FORMAT, 'Access code must be exactly 4 digits').optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  isActive: z.boolean().optional(),
});

const accessCodeSchema = z.object({
  newCode: z.string().regex(TECHNICIAN_CODE_FORMAT, 'Access code must be exactly 4 digits'),
  confirmCode: z.string().regex(TECHNICIAN_CODE_FORMAT, 'Confirmation must be exactly 4 digits'),
});

/**
 * The exact shape returned for a technician employee.
 *
 * Written as an explicit projection rather than a `delete row.accessCodeHash`
 * after the fact: an allowlist cannot leak a column that is added to the model
 * later, whereas a denylist silently starts leaking the moment someone adds a
 * field. `hasAccessCode` is a boolean derived from the hash -- the hash itself
 * never leaves the server.
 */
function toEmployeeResponse(u: {
  id: string; name: string; email: string; isActive: boolean;
  accessCodeHash: string | null; accessCodeSetAt: Date | null; createdAt: Date;
}) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    isActive: u.isActive,
    hasAccessCode: u.accessCodeHash !== null,
    accessCodeSetAt: u.accessCodeSetAt,
    createdAt: u.createdAt,
  };
}

/**
 * One mapping from an assignment failure to a response, so both assignment paths
 * answer identically. Deliberately never names WHICH technician already holds a
 * code -- that would leak the roster's credential layout to a caller probing
 * values.
 */
function sendAssignFailure(res: any, result: Extract<AssignAccessCodeResult, { ok: false }>) {
  if (result.reason === 'NOT_FOUND') {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  if (result.reason === 'CONTENTION') {
    // Refused rather than written non-transactionally: an ambiguous credential
    // is far worse than a retryable error.
    return res.status(503).json({ success: false, error: 'BUSY', message: 'Could not assign the access code right now. Please try again.' });
  }
  return res.status(409).json({ success: false, error: 'CODE_TAKEN', message: 'That access code is already assigned to another technician.' });
}

const EMPLOYEE_SELECT = {
  id: true, name: true, email: true, isActive: true,
  accessCodeHash: true, accessCodeSetAt: true, createdAt: true,
} as const;

/**
 * Shared by this router and by GET /api/config/access-codes, so the Employees
 * page and the Access Codes page are guaranteed to render the same roster from
 * the same query rather than two lists that can disagree.
 */
export async function listTechnicianEmployees() {
  // EXCLUDES the legacy shared account. It lives in the same table but is not an
  // employee identity -- it is a temporary migration bridge. Listing it made it
  // look like a technician permanently "awaiting code setup" (it never has a
  // personal code by definition), so the setup warning could never clear, and it
  // offered Rename/Deactivate actions that would silently break shared-code
  // login for every technician still relying on it.
  const rows = await prisma.user.findMany({
    where: await individualTechnicianWhere(),
    select: EMPLOYEE_SELECT,
    orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
  });
  return rows.map(toEmployeeResponse);
}

router.get('/technicians', async (_req: AuthRequest, res, next) => {
  try {
    res.json({ success: true, data: await listTechnicianEmployees() });
  } catch (e) { next(e); }
});

router.post('/technicians', async (req: AuthRequest, res, next) => {
  try {
    const body = createSchema.parse(req.body);

    // Internal, non-routable address. `users.email` is UNIQUE and NOT NULL, and
    // technicians never authenticate by email -- this satisfies the constraint
    // without inventing a mailbox that does not exist.
    const email = `technician-${randomUUID()}@wfm.local`;

    // `users.password` is NOT NULL. Technicians authenticate by access code, so
    // this account must never be usable via POST /auth/login. A hash of a fresh
    // random secret that is discarded immediately makes email login
    // computationally impossible rather than merely unlikely -- notably it is
    // NOT a hash of the empty string or of the access code.
    const unusablePassword = await bcrypt.hash(randomUUID() + randomUUID(), 10);

    // Serialized against completeTechnicianCutover(). The row is inserted ACTIVE
    // and (at this instant) WITHOUT a code -- including on the with-code path,
    // which assigns afterwards -- so a plain insert here could commit alongside a
    // cutover that never saw it and strand this technician with no way to sign in
    // at all. See runSerializedAgainstCutover() for why serializable isolation on
    // the cutover side alone does not catch that.
    //
    // Both bcrypt hashes are computed ABOVE, outside the transaction: bcrypt is
    // deliberately slow, and holding a serializable transaction open across it
    // would widen the conflict window for no reason.
    const outcome = await runSerializedAgainstCutover((tx) =>
      tx.user.create({
        data: {
          name: body.name,
          email,
          password: unusablePassword,
          // Hardcoded, never taken from the request: this endpoint cannot be used
          // to create an ADMIN or SCHEDULING account.
          role: 'TECHNICIAN',
          isActive: true,
          // The code is NOT set here. It is assigned below through the one
          // concurrency-safe path, so initial assignment and later resets cannot
          // diverge into a safe path and a race-prone one.
        },
        select: EMPLOYEE_SELECT,
      })
    );
    if (!outcome.ok) {
      // Refused rather than retried without the boundary. A technician row that
      // escapes serialization is exactly the defect this exists to prevent.
      return res.status(503).json({ success: false, error: 'BUSY', message: 'Could not create the technician right now. Please try again.' });
    }
    const createdRow = outcome.value;

    // Whether the shared bridge was ALREADY retired as of this insert's own
    // transaction -- nothing more. Deliberately not re-read after the access-code
    // assignment below, because its job is to report which side of the cutover
    // this row was serialized on, and that does not change afterwards.
    //
    // "Can this person sign in?" is `sharedLoginRetired === false || hasAccessCode`,
    // which the caller computes from the two fields together; the flag alone does
    // NOT mean locked out, since a hire created with a code post-cutover can sign
    // in immediately.
    const sharedLoginRetired = outcome.sharedLoginRetired;

    let created = createdRow;
    if (body.accessCode) {
      const result = await assignTechnicianAccessCode({
        technicianId: createdRow.id,
        code: body.accessCode,
        // Brand-new account: there is no prior session to revoke.
        bumpSessionVersion: false,
      });
      if (!result.ok) {
        // The employee row exists but the requested code was refused. Remove it
        // rather than leaving a half-created employee the admin did not ask for
        // -- they submitted "this person WITH this code" as one action.
        await prisma.user.delete({ where: { id: createdRow.id } }).catch((delErr: any) => {
          // Logged, never swallowed: if this compensating delete fails the admin
          // still sees a clean 409 while a code-less TECHNICIAN row survives --
          // and that row then blocks completeTechnicianCutover() with
          // TECHNICIANS_WITHOUT_CODE for a technician nobody knows exists.
          console.error(`[employees] Failed to remove partially-created technician ${createdRow.id} after a rejected access code:`, delErr?.message || delErr);
        });
        return sendAssignFailure(res, result);
      }
      created = await prisma.user.findUniqueOrThrow({ where: { id: createdRow.id }, select: EMPLOYEE_SELECT });
    }

    await writeAudit({
      action: 'CREATE', entityType: 'user', entityId: created.id, userId: req.user!.userId,
      label: `Technician employee '${created.name}' created`,
      labelAr: `تم إنشاء حساب الفني '${created.name}'`,
      // Records THAT a code was set, never the code itself.
      after: { id: created.id, name: created.name, role: 'TECHNICIAN', accessCodeSet: created.accessCodeHash !== null },
    });

    emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.CONFIG_UPDATED, { type: 'technician-employees' });
    res.status(201).json({ success: true, data: { ...toEmployeeResponse(created), sharedLoginRetired } });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'VALIDATION', message: e.errors[0]?.message || 'Validation failed' });
    }
    next(e);
  }
});

router.patch('/technicians/:id', async (req: AuthRequest, res, next) => {
  try {
    const body = updateSchema.parse(req.body);
    if (body.name === undefined && body.isActive === undefined) {
      return res.status(400).json({ success: false, error: 'VALIDATION', message: 'Nothing to update' });
    }

    // REACTIVATION is the second way an active technician can exist without a
    // personal code (reactivate someone whose code was never issued), so the
    // read-then-write runs inside the same serializable boundary as creation --
    // see runSerializedAgainstCutover(). The lookup is inside the transaction
    // too, rather than read first and updated after: at READ COMMITTED the row's
    // isActive could change between the two, which is the same class of
    // TOCTOU this fix exists to close.
    //
    // Renames go through the same path. They cannot strand anyone, but splitting
    // them into a second unserialized branch would mean two ways to update a
    // technician and a standing invitation to add the next isActive-touching
    // field to the wrong one. The cost is a retry on the rare rename that
    // overlaps the one-time cutover.
    const outcome = await runSerializedAgainstCutover(async (tx) => {
      // Scoped to role TECHNICIAN: this endpoint must not be usable to rename or
      // deactivate an ADMIN/SCHEDULING account by guessing its id. A non-technician
      // id is indistinguishable from a nonexistent one -- both plain 404.
      // Scoped to INDIVIDUAL technicians: neither a non-technician account nor the
      // legacy shared bridge can be renamed or deactivated through here. Both are
      // an indistinguishable 404.
      const before = await tx.user.findFirst({
        where: { ...(await individualTechnicianWhere(tx)), id: req.params.id },
        select: EMPLOYEE_SELECT,
      });
      if (!before) return { before: null, updated: null, isActiveChanged: false } as const;

      // v4 decision D9: deactivating must revoke the technician's CURRENT session,
      // not merely block the next login -- otherwise "Deactivate" would leave an
      // offboarded person completing and rescheduling appointments for the rest of
      // their token's 8-hour life.
      //
      // The bump is applied when isActive transitions to false, and ALSO on
      // reactivation. Bumping on reactivation matters: without it, a token issued
      // before deactivation would start working again the moment the account came
      // back, silently resurrecting a session that was deliberately ended.
      // Reactivation must require a fresh login.
      const isActiveChanged = body.isActive !== undefined && body.isActive !== before.isActive;

      const updated = await tx.user.update({
        where: { id: before.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          ...(isActiveChanged ? { sessionVersion: { increment: 1 } } : {}),
        },
        select: EMPLOYEE_SELECT,
      });

      return { before, updated, isActiveChanged } as const;
    });

    if (!outcome.ok) {
      return res.status(503).json({ success: false, error: 'BUSY', message: 'Could not update the technician right now. Please try again.' });
    }
    const { before, updated, isActiveChanged } = outcome.value;
    if (!before || !updated) return res.status(404).json({ success: false, message: 'Not found' });

    // Socket disconnection and the audit write happen AFTER the transaction has
    // committed -- a database transaction must never be held open across network
    // I/O, and a serializable one that may be retried must never emit twice.
    if (isActiveChanged) {
      // HTTP access is already revoked by the version bump above; this closes any
      // socket that is still open so a deactivated technician stops receiving
      // live appointment and customer data immediately rather than at reconnect.
      disconnectUserSockets(updated.id);
    }

    await writeAudit({
      action: 'UPDATE', entityType: 'user', entityId: updated.id, userId: req.user!.userId,
      label: `Technician employee '${before.name}' updated`,
      labelAr: `تم تحديث حساب الفني '${before.name}'`,
      before: { name: before.name, isActive: before.isActive },
      after: { name: updated.name, isActive: updated.isActive },
    });

    emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.CONFIG_UPDATED, { type: 'technician-employees' });
    // Same field, same meaning, as on create: whether the shared bridge was
    // already closed as of this update's own transaction. Read together with
    // `hasAccessCode` it identifies the one genuinely lockout-producing case --
    // reactivating a code-less technician after the cutover, who then has neither
    // credential.
    res.json({ success: true, data: { ...toEmployeeResponse(updated), sharedLoginRetired: outcome.sharedLoginRetired } });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'VALIDATION', message: e.errors[0]?.message || 'Validation failed' });
    }
    next(e);
  }
});

router.put('/technicians/:id/access-code', async (req: AuthRequest, res, next) => {
  try {
    const body = accessCodeSchema.parse(req.body);
    if (body.newCode !== body.confirmCode) {
      return res.status(400).json({ success: false, error: 'MISMATCH', message: 'New code and confirmation do not match' });
    }

    const target = await prisma.user.findFirst({
      where: { ...(await individualTechnicianWhere()), id: req.params.id },
      select: { id: true, name: true },
    });
    if (!target) return res.status(404).json({ success: false, message: 'Not found' });

    // Deliberately NO "current code" challenge, unlike the department-code
    // rotation in routes/config.ts. That flow can verify the current code because
    // it is stored in plaintext; these are hashed and unreadable by design, which
    // is the point. Administration is already the authority for issuing a
    // technician's credential, and requiring the old code would mean either
    // storing it reversibly or making a forgotten code unrecoverable. Both are
    // worse. The action is ADMIN-only and audited.
    // Uniqueness check + write happen together inside one serializable
    // transaction (S2). The exclusion of this technician's own current code lives
    // in there too, so re-entering the same code for the same person is not
    // reported as a collision with themselves.
    //
    // v4 decision D9: replacing the credential ends every session established
    // with the OLD one, so sessionVersion is bumped inside the same transaction.
    const result = await assignTechnicianAccessCode({
      technicianId: target.id,
      code: body.newCode,
      bumpSessionVersion: true,
    });
    if (!result.ok) return sendAssignFailure(res, result);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: target.id }, select: EMPLOYEE_SELECT });
    // Socket disconnection happens AFTER the transaction commits -- a database
    // transaction must never be held open across network I/O.
    disconnectUserSockets(target.id);

    await writeAudit({
      action: 'UPDATE', entityType: 'user', entityId: target.id, userId: req.user!.userId,
      label: `Access code changed for technician '${target.name}'`,
      labelAr: `تم تغيير رمز الدخول للفني '${target.name}'`,
      // Records only THAT the code changed and for whom. The code is never in
      // the audit trail.
      after: { technicianId: target.id, technicianName: target.name, accessCodeChanged: true },
    });

    emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.CONFIG_UPDATED, { type: 'technician-employees' });
    res.json({ success: true, data: toEmployeeResponse(updated) });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'VALIDATION', message: e.errors[0]?.message || 'Validation failed' });
    }
    next(e);
  }
});

/**
 * Migration status for the Employees page's dedicated panel.
 *
 * Deliberately separate from the employee list: this is setup information about
 * a temporary bridge, not an employee record.
 */
router.get('/technician-migration', async (_req: AuthRequest, res, next) => {
  try {
    const [retired, eligibility] = await Promise.all([
      readSharedLoginRetirementFlag(),
      getCutoverEligibility(),
    ]);
    res.json({
      success: true,
      data: {
        sharedLoginRetired: retired,
        canCompleteCutover: !retired && eligibility.eligible,
        blockedReason: eligibility.eligible ? null : eligibility.reason,
        techniciansWithoutCode: eligibility.eligible ? 0 : eligibility.missingCount,
      },
    });
  } catch (e) { next(e); }
});

/**
 * Complete the technician identity migration -- the ONE-WAY cutover.
 *
 * A purpose-built action, deliberately not a generic SystemConfig mutation
 * endpoint: the server decides what is written. The request body is ignored
 * entirely, so no caller can send `retired: false` or any other value. There is
 * no inverse endpoint, and nothing anywhere sets the flag back to false.
 */
router.post('/technician-cutover', async (req: AuthRequest, res, next) => {
  try {
    const result = await completeTechnicianCutover();

    if (!result.ok) {
      if (result.reason === 'CONTENTION') {
        // Not a precondition failure and not a fault: a concurrent roster change
        // kept aborting the eligibility check. Nothing was written, and the
        // cutover is safe to attempt again -- so say "busy", not "conflict" and
        // certainly not 500.
        return res.status(503).json({ success: false, error: 'BUSY', message: 'Could not complete the migration right now. Please try again.' });
      }
      return res.status(409).json({
        success: false,
        error: result.reason,
        message: result.reason === 'NO_INDIVIDUAL_TECHNICIANS'
          ? 'Create at least one technician employee with a personal access code before completing the migration.'
          : 'Every active technician must have a personal access code before completing the migration.',
        techniciansWithoutCode: result.missingCount,
      });
    }

    // Idempotent: a repeat call reports the existing state and changes nothing,
    // and is not audited again as if it were a fresh transition.
    if (!result.alreadyRetired) {
      await writeAudit({
        action: 'UPDATE', entityType: 'system_config', entityId: 'technician_shared_login',
        userId: req.user!.userId,
        label: 'Technician identity migration completed — shared technician login permanently retired',
        labelAr: 'تم إكمال نقل حسابات الفنيين — تم تعطيل رمز الدخول المشترك نهائياً',
        // Records the transition only. No credential material.
        after: { sharedLoginRetired: true },
      });
      emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.CONFIG_UPDATED, { type: 'technician-cutover' });
    }

    res.json({ success: true, data: { sharedLoginRetired: true, alreadyRetired: result.alreadyRetired } });
  } catch (e) { next(e); }
});

export default router;
