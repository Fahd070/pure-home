import { Prisma } from '@prisma/client';

export type DashboardOperationalCategory =
  | 'completed'
  | 'postponed'
  | 'overdue'
  | 'today'
  | 'thisMonth'
  | 'nextMonth';

/**
 * Single source of truth for the mutually-exclusive, non-urgent dashboard
 * workflow. Precedence is encoded by excluding stronger states from every
 * lower date bucket: completed > postponed > overdue > today > current month
 * > next month. Urgent visits intentionally use their separate workflow.
 */
export function getDashboardCategoryWheres(now = new Date()): Record<DashboardOperationalCategory, Prisma.AppointmentWhereInput> {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const startOfFollowingMonth = new Date(now.getFullYear(), now.getMonth() + 2, 1);

  const nonUrgentWithCustomer: Prisma.AppointmentWhereInput = {
    isUrgent: false,
    customerId: { not: null },
  };
  const active: Prisma.AppointmentWhereInput = {
    ...nonUrgentWithCustomer,
    status: { in: ['SCHEDULED', 'RESCHEDULED', 'PENDING'] },
    workStatus: { in: ['WAITING', 'IN_PROGRESS'] },
  };

  return {
    completed: { ...nonUrgentWithCustomer, workStatus: 'COMPLETED' },
    postponed: { ...nonUrgentWithCustomer, workStatus: 'POSTPONED' },
    overdue: { ...active, scheduledDate: { lt: startOfToday } },
    today: { ...active, scheduledDate: { gte: startOfToday, lt: startOfTomorrow } },
    thisMonth: { ...active, scheduledDate: { gte: startOfTomorrow, lt: startOfNextMonth } },
    nextMonth: { ...active, scheduledDate: { gte: startOfNextMonth, lt: startOfFollowingMonth } },
  };
}
