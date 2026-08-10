// Source-level regression tests for the completion-technician-name-display +
// customer-secondary-phone batch. Follows this project's established pattern
// (see technicianNameCompletion.test.ts, completionDetailsAndUrgentTechnicianName.test.ts):
// assertions against the exact production wiring rather than a full render,
// matching precedent for this class of change.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import i18n from '../../unified-app/src/i18n';

const adminTechniciansSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/admin/pages/Technicians.tsx'), 'utf-8');
const backendAppointmentsSrc = fs.readFileSync(path.resolve(__dirname, '../../backend/src/routes/appointments.ts'), 'utf-8');
const backendTechniciansSrc = fs.readFileSync(path.resolve(__dirname, '../../backend/src/routes/technicians.ts'), 'utf-8');
const backendCustomersSrc = fs.readFileSync(path.resolve(__dirname, '../../backend/src/routes/customers.ts'), 'utf-8');
const schemaPrisma = fs.readFileSync(path.resolve(__dirname, '../../backend/prisma/schema.prisma'), 'utf-8');
const adminAddCustomerSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/admin/pages/AddCustomer.tsx'), 'utf-8');
const schedAddCustomerSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/scheduling/pages/AddCustomer.tsx'), 'utf-8');
const adminCustomerDetailSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/admin/pages/CustomerDetail.tsx'), 'utf-8');
const schedCustomerListSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/scheduling/pages/CustomerList.tsx'), 'utf-8');
const schedAppointmentDetailSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/scheduling/pages/AppointmentDetail.tsx'), 'utf-8');
const technicianTaskDetailSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/technician/pages/TaskDetail.tsx'), 'utf-8');

describe('Part A: completionTechnicianName is persisted (schema + route)', () => {
  it('schema: Appointment.completionTechnicianName is a nullable String (existing completed rows stay valid)', () => {
    expect(schemaPrisma).toMatch(/completionTechnicianName\s+String\?/);
  });
  it('1/2. the requirement + FIRST_NAME_RE validation for a non-admin completion are unchanged by this batch', () => {
    expect(backendAppointmentsSrc).toMatch(/if \(!trimmedTechnicianName\) return res\.status\(400\)/);
    expect(backendAppointmentsSrc).toMatch(/if \(!FIRST_NAME_RE\.test\(trimmedTechnicianName\)\) return res\.status\(400\)/);
  });
  it('3. the update() data block now persists completionTechnicianName', () => {
    expect(backendAppointmentsSrc).toMatch(/completionTechnicianName: trimmedTechnicianName \|\| null,/);
  });
  it('4. the technician relation/req.user!.userId remain the only identity used for the /complete ownership check -- technicianName never appears in that where clause', () => {
    const completeRouteBody = backendAppointmentsSrc.split("router.patch('/:id/complete'")[1]?.split("router.patch('/:id/confirm-operation'")[0] || '';
    expect(completeRouteBody).toMatch(/isUrgent: false,/);
    expect(completeRouteBody).toMatch(/OR: \[\{ technicianId: req\.user!\.userId \}, \{ technicianId: null \}\]/);
    const beforeBlock = completeRouteBody.match(/const before = await prisma\.appointment\.findFirst\(\{[\s\S]*?\n {4}\}\);/)?.[0] || '';
    expect(beforeBlock).not.toMatch(/technicianName/);
  });
  it('5. GET /technicians selects completionTechnicianName alongside the other completion fields', () => {
    expect(backendTechniciansSrc).toMatch(/completionTechnicianName: true/);
  });
  it('7. the Scheduling privacy-stripping block does not delete completionTechnicianName (non-financial, unlike completionAmount/completionPaymentMethod/completionImage)', () => {
    const stripBlock = backendTechniciansSrc.match(/if \(!isAdmin\) \{[\s\S]*?\n {4}\}/)?.[0] || '';
    expect(stripBlock).not.toMatch(/delete appt\.completionTechnicianName/);
  });
});

describe('6. Admin Technicians completion details: legacy fallback to the technician relation\'s first name', () => {
  it('uses firstNameOf(), imported from TaskDetail.tsx (reused, not re-implemented)', () => {
    expect(adminTechniciansSrc).toMatch(/import \{ firstNameOf \} from "\.\.\/\.\.\/technician\/pages\/TaskDetail";/);
  });
  it('the displayed value is the submitted name when present, otherwise the technician\'s first name -- never blank when the technician relation can identify them', () => {
    expect(adminTechniciansSrc).toMatch(/\{taskDetail\.task\.completionTechnicianName \|\| firstNameOf\(taskDetail\.techName\)\}/);
  });
});

describe('Part B: Customer.secondaryPhone schema + backend', () => {
  it('schema: Customer.secondaryPhone is a nullable String (existing customers stay valid)', () => {
    expect(schemaPrisma).toMatch(/secondaryPhone\s+String\?/);
  });
  it('11/12. reuses the same PHONE_RE as the primary phone, not a second regex, and rejects a secondary equal to the primary', () => {
    const matches = backendCustomersSrc.match(/PHONE_RE\s*=\s*\/\^05\\d\{8\}\$\//g) || [];
    expect(matches.length).toBe(1); // declared exactly once, reused for both checks
    expect(backendCustomersSrc).toMatch(/if \(trimmed === primaryPhone\) return \{ error: 'رقم الجوال الإضافي يجب أن يكون مختلفًا عن رقم الجوال الأساسي' \}/);
  });
  it('18. the customer search where.OR clause includes secondaryPhone alongside name/phone', () => {
    expect(backendCustomersSrc).toMatch(/\{ secondaryPhone: \{ contains: search \} \}/);
  });
});

describe('Part B: Customer create forms (Admin + Scheduling) expose the optional secondary phone', () => {
  for (const [label, src] of [['Admin', adminAddCustomerSrc], ['Scheduling', schedAddCustomerSrc]] as const) {
    it(`${label}: renders an optional (non-required) secondaryPhone field with the exact required label`, () => {
      expect(src).toMatch(/field\("secondaryPhone", t\("customers\.secondaryPhone"\)\)/);
      // Confirms the 4th `field(...)` argument (required) is omitted/false -- not `field("secondaryPhone", ..., "text", true)`.
      expect(src).not.toMatch(/field\("secondaryPhone",[^)]*,\s*true\)/);
    });
    it(`${label}: the primary phone field now uses the dedicated "Primary Mobile Number" label`, () => {
      expect(src).toMatch(/field\("phone", t\("customers\.primaryPhone"\), "text", true\)/);
    });
    it(`${label}: validates format only when non-blank, and rejects a value equal to the primary phone`, () => {
      expect(src).toMatch(/if \(!PHONE_RE\.test\(trimmedSecondary\)\) e\.secondaryPhone = t\("customers\.secondaryPhoneInvalid"\)/);
      expect(src).toMatch(/else if \(trimmedSecondary === form\.phone\) e\.secondaryPhone = t\("customers\.secondaryPhoneSameAsPrimary"\)/);
    });
    it(`${label}: submits a trimmed secondaryPhone, or undefined when blank (never an empty-string false positive)`, () => {
      expect(src).toMatch(/secondaryPhone: secondaryPhone\.trim\(\) \|\| undefined/);
    });
  }
});

describe('i18n: secondary phone labels/messages exist in both languages with the exact required Arabic wording', () => {
  it('customers.secondaryPhone matches the exact requested Arabic label', () => {
    expect(i18n.getFixedT('ar')('customers.secondaryPhone')).toBe('رقم جوال إضافي');
    expect(i18n.getFixedT('en')('customers.secondaryPhone')).toBe('Additional Mobile Number');
  });
  it('customers.secondaryPhoneSameAsPrimary matches the exact requested Arabic validation message', () => {
    expect(i18n.getFixedT('ar')('customers.secondaryPhoneSameAsPrimary'))
      .toBe('رقم الجوال الإضافي يجب أن يكون مختلفًا عن رقم الجوال الأساسي');
  });
});

describe('15/17. Admin customer details (CustomerDetail.tsx) show the secondary phone only when present', () => {
  it('the on-screen header conditionally renders a second line for secondaryPhone', () => {
    expect(adminCustomerDetailSrc).toMatch(/\{c\.secondaryPhone && <p className="text-slate-500">\{t\("customers\.secondaryPhone"\)\}: \{c\.secondaryPhone\}<\/p>\}/);
  });
  it('the PDF export conditionally includes a secondary-phone row, never an empty one', () => {
    expect(adminCustomerDetailSrc).toMatch(/\$\{c\.secondaryPhone \? `<div><div class="lbl">/);
  });
});

describe('16/17. Scheduling/Maintenance customer details (CustomerList.tsx HistoryModal) show the secondary phone only when present', () => {
  it('renders primary phone, and conditionally an additional-mobile line, never an empty row', () => {
    expect(schedCustomerListSrc).toMatch(/\{customer\.secondaryPhone && <span className="ms-2">\{t\("customers\.secondaryPhone"\)\}: \{customer\.secondaryPhone\}<\/span>\}/);
  });
});

describe('Appointment/customer detail cards (Scheduling AppointmentDetail + Technician TaskDetail) show the secondary phone only when present', () => {
  it('Scheduling AppointmentDetail.tsx conditionally renders the secondary phone', () => {
    expect(schedAppointmentDetailSrc).toMatch(/\{a\.customer\?\.secondaryPhone && \(/);
  });
  it('Technician TaskDetail.tsx conditionally renders the secondary phone', () => {
    expect(technicianTaskDetailSrc).toMatch(/\{customer\?\.secondaryPhone && \(/);
  });
});
