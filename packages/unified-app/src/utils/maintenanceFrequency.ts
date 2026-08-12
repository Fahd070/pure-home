// Part D: mirrors the backend's half-month-step business rule (isHalfMonthStep
// in routes/customers.ts) -- recurrence must be a positive multiple of 0.5
// (1, 1.5, 2, 2.5, ...), never an arbitrary decimal like 1.2, and never
// zero/negative. Single source of truth for both Add Customer forms
// (admin/pages/AddCustomer.tsx, scheduling/pages/AddCustomer.tsx).
export function isValidMaintenanceFrequency(value: number): boolean {
  if (!Number.isFinite(value) || value <= 0) return false;
  const doubled = value * 2;
  return Math.abs(doubled - Math.round(doubled)) < 1e-9;
}
