import prisma from '../prisma';

// Appointment.customerId is ON DELETE SET NULL at the DB level (a deliberate,
// separate decision -- see schema.prisma -- so an appointment can never be
// silently destroyed as a mere FK side-effect of deleting *some* customer row
// through *any* code path). The explicit "Admin deletes this customer"
// business action is different: it must not leave that customer's still-
// actionable appointments/tasks behind as permanent, uneditable ghost cards
// in Scheduling/Technician views. So customer deletion explicitly,
// transactionally deletes only the OPERATIONAL appointments
// (WAITING/IN_PROGRESS/POSTPONED -- i.e. still live work, nothing has been
// recorded about them yet) belonging to this customer. COMPLETED appointments
// are deliberately left alone (their customerId becomes null via the FK):
// they carry real historical/financial data (completionAmount,
// serviceDetails, actualCompletionDate) that must survive a customer
// deletion, matching the recorded SET NULL rationale, and they never appear
// in Work Queue or any "live" list (those only ever query non-COMPLETED
// workStatus). Urgent appointments (isUrgent: true) are also left alone:
// their real completion record lives in UrgentVisitRecord, keyed 1:1 off the
// Appointment row (onDelete: Cascade) -- deleting them here would destroy
// that separate historical record, and urgent-vs-normal isolation is
// explicitly out of scope for this fix.
export const OPERATIONAL_WORK_STATUSES = ['WAITING', 'IN_PROGRESS', 'POSTPONED'];

export interface CustomerDeletionResult {
  customer: { id: string; name: string; [key: string]: any };
  operationalAppointmentIds: string[];
}

// Shared by both DELETE /api/customers/:id (the canonical route) and
// DELETE /api/dashboard/customer/:id (the Admin Dashboard drill-down's
// delete button, a genuinely separate, live call site -- see
// dashboardDelete.test.ts) so the two can never again silently drift apart
// on this business rule the way they previously did.
export async function deleteCustomerWithOperationalCleanup(customerId: string): Promise<CustomerDeletionResult | null> {
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({
      where: { id: customerId },
      include: { appointments: { select: { id: true, isUrgent: true, workStatus: true } } },
    });
    if (!customer) return null;

    const operationalAppointmentIds = customer.appointments
      .filter((a) => !a.isUrgent && OPERATIONAL_WORK_STATUSES.includes(a.workStatus))
      .map((a) => a.id);

    if (operationalAppointmentIds.length > 0) {
      await tx.appointment.deleteMany({ where: { id: { in: operationalAppointmentIds } } });
    }
    await tx.customer.delete({ where: { id: customerId } });

    return { customer, operationalAppointmentIds };
  });
}
