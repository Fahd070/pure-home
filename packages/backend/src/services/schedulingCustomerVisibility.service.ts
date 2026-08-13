// A customer created solely for an unapproved urgent appointment is private to
// Administration until that appointment is approved for Scheduling.
export const hiddenUrgentOnlyCustomerForScheduling: any = {
  createdBy: { is: { role: 'ADMIN' } },
  appointments: {
    some: { isUrgent: true, visibleToScheduling: false },
    every: { isUrgent: true, visibleToScheduling: false },
  },
};

export function applySchedulingCustomerVisibility(where: any = {}) {
  return { ...where, NOT: hiddenUrgentOnlyCustomerForScheduling };
}
