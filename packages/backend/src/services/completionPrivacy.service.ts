// SAFE PROJECTION FOR THE `User` RELATION.
//
// Prisma's `include: { technician: true }` loads EVERY scalar column of the
// related user row -- which now means `accessCodeHash` (the bcrypt hash of a
// technician's 4-digit access code), `password`, and `sessionVersion`, none of
// which any client has any reason to see.
//
// The access-code hash is the dangerous one: a 4-digit code is only 10,000
// combinations, so a leaked bcrypt hash can be exhausted offline in seconds,
// entirely bypassing the online rate limiter. Recovering a colleague's code
// means authenticating AS them, which would silently misattribute every
// completion, postponement and audit entry -- destroying the exact
// accountability the per-technician identity work exists to create.
//
// `include: true` is a DENYLIST by omission: it starts leaking the moment a
// column is added to the model. This allowlist cannot. Use it for EVERY
// technician/user relation that reaches a response or a socket payload.
export const TECHNICIAN_PUBLIC_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
} as const;

/** The include fragment to use in place of `technician: true`. */
export const TECHNICIAN_PUBLIC_INCLUDE = { select: TECHNICIAN_PUBLIC_SELECT } as const;

// Modification #6: completionAmount/completionPaymentMethod are private to ADMIN
// and TECHNICIAN only -- SCHEDULING must never receive them, from any response
// shape or socket room. Centralized here because the fields appear, unfiltered by
// default, in several independently-built response shapes (raw appointment,
// appointment nested under a customer, or an array of either) across
// appointments.ts, customers.ts and dashboard.ts. Untyped (`any`), matching this
// codebase's existing convention for loosely-shaped Prisma query results built
// from dynamic `include` options.
//
// Privacy Patch #2: extended to cover two more fields in the same category,
// already established as SCHEDULING-private by the technicians roster view
// (routes/technicians.ts strips completionImage from its own !isAdmin branch)
// and by the appointment list route (which already stripped
// urgentVisitRecord.amount/paymentMethod for SCHEDULING, just not everywhere
// else) -- completionImage, and the nested urgentVisitRecord's own
// amount/paymentMethod (completion-adjacent financial data, same category as
// completionAmount). Centralizing here so every call site gets the full,
// consistent redaction instead of each route re-implementing its own subset.

export function stripCompletionAmount(appt: any): any {
  const out: any = {
    ...appt,
    completionAmount: undefined,
    completionPaymentMethod: undefined,
    completionImage: undefined,
  };
  // Copy (never mutate the original Prisma object) before redacting the nested
  // record, same convention as the outer spread above.
  if (appt.urgentVisitRecord) {
    out.urgentVisitRecord = { ...appt.urgentVisitRecord, amount: undefined, paymentMethod: undefined };
  }
  return out;
}

export function stripCompletionAmountFromList(appts: any[]): any[] {
  return appts.map(stripCompletionAmount);
}

export function stripCompletionAmountFromCustomers(customers: any[]): any[] {
  return customers.map(c => (
    c.appointments ? { ...c, appointments: stripCompletionAmountFromList(c.appointments) } : c
  ));
}

// Privacy Patch #2: Customer.installationAmount/installationPaymentMethod are
// installation-financial data -- routes/customers.ts's own schema comment
// scopes that section to "Admin + Scheduling", and no Technician-facing page
// in the frontend ever reads either field. A Technician's assigned-job
// appointment carries a full nested `customer` include (needed for the
// customer's name/phone/address/notes, which the job genuinely requires) --
// this only strips the two financial fields out of that include, leaving
// every other customer field the job needs untouched.
export function stripInstallationFinancialsFromCustomer(customer: any): any {
  if (!customer) return customer;
  return { ...customer, installationAmount: undefined, installationPaymentMethod: undefined };
}
