// Single source of truth for the primary-phone format used across every
// customer-identity-collecting form (Admin/Scheduling Add Customer, Admin
// Urgent Appointment creation) -- mirrors the backend's PHONE_RE
// (packages/backend/src/routes/customers.ts). Saudi mobile format: "05" + 8
// digits, 10 digits total.
export const PHONE_RE = /^05\d{8}$/;

export function isValidPrimaryPhone(value: string): boolean {
  return PHONE_RE.test(value);
}
