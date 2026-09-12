import { Prisma } from '@prisma/client';
import { MaintenanceBucket, maintenanceBucketBoundaries } from './maintenanceSchedule.service';

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

// ---------------------------------------------------------------------------
// Maintenance due buckets (v4 Requirement #4)
// ---------------------------------------------------------------------------
//
// The appointment categories above answer "what work is booked". These answer a
// different question -- "which customers are due for maintenance" -- and they
// deliberately do NOT look at appointments at all. That is the whole point of
// Requirement #4: a customer whose filter is due is due whether or not anyone
// has got around to booking a visit, and the previous appointment-derived
// counters made exactly those customers invisible.
//
// The date boundaries come from maintenanceSchedule.service.ts rather than being
// recomputed here, so the SQL the counters run and the TypeScript that classifies
// a single row can never drift apart.

/**
 * Mutually exclusive, exhaustive Prisma filters over Customer.nextMaintenanceDueAt.
 *
 * Every boundary is a 00:00 UTC instant, which is what makes comparing the raw
 * stored timestamp equivalent to comparing its UTC calendar day: a due date can
 * only carry a non-negative intra-day offset, and adding hours to a date can
 * never move it back across a preceding midnight. So these produce exactly the
 * same answer as getMaintenanceBucket() does in memory -- verified by test.
 */
export function getMaintenanceBucketWheres(now = new Date()): Record<MaintenanceBucket, Prisma.CustomerWhereInput> {
  const { startOfToday, startOfNextMonth, startOfFollowingMonth } = maintenanceBucketBoundaries(now);
  return {
    OVERDUE:    { nextMaintenanceDueAt: { lt: startOfToday } },
    THIS_MONTH: { nextMaintenanceDueAt: { gte: startOfToday, lt: startOfNextMonth } },
    NEXT_MONTH: { nextMaintenanceDueAt: { gte: startOfNextMonth, lt: startOfFollowingMonth } },
    FUTURE:     { nextMaintenanceDueAt: { gte: startOfFollowingMonth } },
    UNKNOWN:    { nextMaintenanceDueAt: null },
  };
}
