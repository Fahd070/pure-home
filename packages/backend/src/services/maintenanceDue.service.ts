// The ONLY writer of Customer.nextMaintenanceDueAt.
//
// Split from maintenanceSchedule.service.ts deliberately: that file is pure date
// math with no database dependency (which is what makes it trivially unit
// testable), while this one is the persistence half. Keeping them separate stops
// the pure calculator from acquiring a Prisma import, and keeps the rule "there
// is exactly one implementation of the date math" visibly true -- everything
// here delegates to computeNextMaintenanceDate() rather than doing any date
// arithmetic of its own.
//
// Requirement #4/decision D1: nextMaintenanceDueAt is materialized so it can be
// sorted and filtered in SQL. It is fully derived, so it is always safe to
// recompute, and recomputing is idempotent.
import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { computeNextMaintenanceDate, MaintenanceCycleType } from './maintenanceSchedule.service';

/**
 * Accepts either the PrismaClient or a transaction client, so recalculation can
 * join the caller's transaction. That matters: a completed appointment and the
 * due date it implies must commit together, or a crash between them leaves a
 * customer whose stored due date disagrees with their own history.
 */
type PrismaLike = Prisma.TransactionClient | typeof prisma;

// Exactly the columns the calculation reads -- nothing else is loaded, so this
// stays cheap enough to run inline on every relevant mutation.
const CUSTOMER_FIELDS = {
  id: true,
  maintenanceCycle: true,
  maintenanceFrequency: true,
  previousServiceDate: true,
  installationDate: true,
} as const;

const APPOINTMENT_FIELDS = {
  isUrgent: true,
  workStatus: true,
  actualCompletionDate: true,
  completedAt: true,
  scheduledDate: true,
} as const;

/**
 * Recomputes and stores one customer's next-maintenance due date.
 *
 * Returns the stored value (or null when no baseline exists). A missing customer
 * is not an error -- it simply returns null, so callers that run this after a
 * deletion cascade do not have to guard.
 */
export async function recalculateCustomerMaintenanceDue(
  client: PrismaLike,
  customerId: string
): Promise<Date | null> {
  const customer = await client.customer.findUnique({
    where: { id: customerId },
    select: CUSTOMER_FIELDS,
  });
  if (!customer) return null;

  const appointments = await client.appointment.findMany({
    where: { customerId },
    select: APPOINTMENT_FIELDS,
  });

  const dueAt = computeNextMaintenanceDate(
    {
      maintenanceCycle: customer.maintenanceCycle as MaintenanceCycleType,
      maintenanceFrequency: customer.maintenanceFrequency,
      previousServiceDate: customer.previousServiceDate,
      installationDate: customer.installationDate,
    },
    appointments
  );

  // Deliberately does NOT touch `version`: this is a derived field maintained by
  // the system, not a user edit, so it must never invalidate another user's
  // in-flight optimistic-concurrency token and make them re-enter a form.
  await client.customer.update({
    where: { id: customerId },
    data: { nextMaintenanceDueAt: dueAt },
  });

  return dueAt;
}

/**
 * The fields whose change alters a customer's maintenance baseline or recurrence.
 *
 * Used by the customer update route so a recalculation runs when it is actually
 * needed and not on every unrelated edit (a phone-number change cannot move a
 * due date). Kept here, beside the calculation that consumes them, so the list
 * cannot drift away from what computeNextMaintenanceDate() actually reads.
 */
const MAINTENANCE_RELEVANT_CUSTOMER_FIELDS = [
  'maintenanceCycle',
  'maintenanceFrequency',
  'installationDate',
  'previousServiceDate',
] as const;

export function touchesMaintenanceBaseline(changed: Record<string, unknown>): boolean {
  return MAINTENANCE_RELEVANT_CUSTOMER_FIELDS.some((field) => field in changed);
}
