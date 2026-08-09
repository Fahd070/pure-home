// Modification #6: completionAmount/completionPaymentMethod are private to ADMIN
// and TECHNICIAN only -- SCHEDULING must never receive them, from any response
// shape or socket room. Centralized here because the fields appear, unfiltered by
// default, in several independently-built response shapes (raw appointment,
// appointment nested under a customer, or an array of either) across
// appointments.ts, customers.ts and dashboard.ts. Untyped (`any`), matching this
// codebase's existing convention for loosely-shaped Prisma query results built
// from dynamic `include` options.

export function stripCompletionAmount(appt: any): any {
  return { ...appt, completionAmount: undefined, completionPaymentMethod: undefined };
}

export function stripCompletionAmountFromList(appts: any[]): any[] {
  return appts.map(stripCompletionAmount);
}

export function stripCompletionAmountFromCustomers(customers: any[]): any[] {
  return customers.map(c => (
    c.appointments ? { ...c, appointments: stripCompletionAmountFromList(c.appointments) } : c
  ));
}
