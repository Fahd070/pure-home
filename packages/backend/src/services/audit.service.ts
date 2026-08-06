import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { emitToRoles } from '../socket';
import { SOCKET_EVENTS } from '../constants';

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE';

export interface AuditOptions {
  action: AuditAction;
  entityType: string;
  entityId: string;
  userId: string;
  label: string;
  labelAr?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

export async function writeAudit(opts: AuditOptions) {
  const storedLabel = opts.labelAr
    ? `${opts.label}|||${opts.labelAr}`
    : opts.label;
  const log = await prisma.auditLog.create({
    data: {
      action: storedLabel,
      entityType: opts.entityType,
      entityId: opts.entityId,
      userId: opts.userId,
      beforeState: (opts.before ?? undefined) as Prisma.InputJsonValue | undefined,
      afterState: (opts.after ?? undefined) as Prisma.InputJsonValue | undefined,
    },
    include: { user: { select: { id: true, name: true, role: true } } },
  });
  // Payload intentionally minimized: the audit log's beforeState/afterState can contain
  // customer PII, appointment details, and admin action descriptions. All current
  // frontend subscribers (admin/scheduling/technician Messages pages) only use this
  // event as a "something changed, refetch" signal -- they never read fields off it --
  // so a bare id is sufficient and closes the leak without changing any UI behavior.
  emitToRoles(['ADMIN', 'SCHEDULING', 'TECHNICIAN'], SOCKET_EVENTS.AUDIT_NEW, { id: log.id });
  return log;
}
