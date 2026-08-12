// Part A: resolves an urgent appointment's Admin-entered customer identity
// (name + primary phone) to an existing Customer, or creates one -- the
// single reusable place this happens, called only from the urgent-appointment
// creation transaction in routes/appointments.ts. Reuses the exact same
// primary-phone validation as normal customer creation (PHONE_RE, see
// routes/customers.ts) rather than a second implementation.
//
// Matching rule: reuse by phone alone (the application's existing
// primary-phone identity rule -- phone is how every other part of this system
// already treats "the same customer", e.g. Customer.phone has no secondary
// uniqueness dimension). This intentionally differs from the older,
// completion-time auto-create logic this replaces (routes/urgent-visits.ts's
// removed block), which additionally required a case-insensitive name match --
// that heuristic existed only because a Technician (not Admin) was the one
// typing the identity after the fact, a decision Part A/B of this batch moves
// to Admin, at creation time, before the job is dispatched.
import { Prisma, PrismaClient } from '@prisma/client';
import { PHONE_RE } from '../routes/customers';

type Tx = Prisma.TransactionClient | PrismaClient;

export interface UrgentCustomerIdentity {
  name: string;
  phone: string;
}

export interface UrgentAddressFallback {
  city?: string;
  district?: string;
  street?: string;
  postalCode?: string;
  buildingNo?: string;
  floorNo?: string;
  apartmentNo?: string;
}

export class InvalidCustomerIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCustomerIdentityError';
  }
}

export function validateUrgentCustomerIdentity(name: string | undefined, phone: string | undefined): UrgentCustomerIdentity {
  const trimmedName = (name || '').trim();
  const trimmedPhone = (phone || '').trim();
  if (!trimmedName) throw new InvalidCustomerIdentityError('Customer name is required');
  if (!PHONE_RE.test(trimmedPhone)) throw new InvalidCustomerIdentityError('Invalid customer phone number');
  return { name: trimmedName, phone: trimmedPhone };
}

// Placeholder used for address sub-fields the urgent-creation form doesn't
// collect (it only asks for city/district/street -- see admin/pages/UrgentAppointments.tsx).
// Same convention as the completion-time auto-create logic this replaces.
const ADDRESS_PLACEHOLDER = '—';

export async function resolveOrCreateUrgentCustomer(
  tx: Tx,
  identity: UrgentCustomerIdentity,
  opts: { addressFallback?: UrgentAddressFallback; createdById?: string | null } = {}
): Promise<{ customer: { id: string; name: string; phone: string }; created: boolean }> {
  const existing = await tx.customer.findFirst({ where: { phone: identity.phone } });
  if (existing) {
    return { customer: { id: existing.id, name: existing.name, phone: existing.phone }, created: false };
  }

  const addr = opts.addressFallback || {};
  const customer = await tx.customer.create({
    data: {
      name: identity.name,
      phone: identity.phone,
      maintenanceCycle: 'MONTHLY',
      maintenanceFrequency: 1,
      createdById: opts.createdById || undefined,
      address: {
        create: {
          city: addr.city || ADDRESS_PLACEHOLDER,
          district: addr.district || ADDRESS_PLACEHOLDER,
          street: addr.street || ADDRESS_PLACEHOLDER,
          postalCode: addr.postalCode || undefined,
          buildingNo: addr.buildingNo || undefined,
          floorNo: addr.floorNo || undefined,
          apartmentNo: addr.apartmentNo || undefined,
        },
      },
    },
  });
  return { customer: { id: customer.id, name: customer.name, phone: customer.phone }, created: true };
}
