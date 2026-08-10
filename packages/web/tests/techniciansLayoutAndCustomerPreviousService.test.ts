// Focused modification batch: (A) Admin -> Technicians page layout redesign
// ONLY (no data/business-logic change), and (B) optional customer "Previous
// Service" historical record. Follows this project's established
// source-level assertion pattern (see completionTechnicianNameAndSecondaryPhone.test.ts).
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import i18n from '../../unified-app/src/i18n';

const adminTechniciansSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/admin/pages/Technicians.tsx'), 'utf-8');
const backendCustomersSrc = fs.readFileSync(path.resolve(__dirname, '../../backend/src/routes/customers.ts'), 'utf-8');
const schemaPrisma = fs.readFileSync(path.resolve(__dirname, '../../backend/prisma/schema.prisma'), 'utf-8');
const adminAddCustomerSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/admin/pages/AddCustomer.tsx'), 'utf-8');
const schedAddCustomerSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/scheduling/pages/AddCustomer.tsx'), 'utf-8');
const adminCustomerDetailSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/admin/pages/CustomerDetail.tsx'), 'utf-8');
const schedCustomerListSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/scheduling/pages/CustomerList.tsx'), 'utf-8');

describe('Part A: Admin Technicians page layout (design only)', () => {
  it('1. the technician cards grid is wrapped in a centered container', () => {
    expect(adminTechniciansSrc).toMatch(/<div className="max-w-5xl mx-auto">\s*\n\s*<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3/);
  });
  it('2. the grid retains its responsive column breakpoints and has an expanded gap/card padding', () => {
    expect(adminTechniciansSrc).toMatch(/grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5/);
    expect(adminTechniciansSrc).toMatch(/bg-white rounded-xl shadow-sm p-6/);
  });
  it('3. technician data/actions are byte-for-byte unchanged: same click handlers, same count fields, same API query', () => {
    expect(adminTechniciansSrc).toMatch(/queryKey: \["technicians-detail"\]/);
    expect(adminTechniciansSrc).toMatch(/api\.get\("\/technicians"\)/);
    expect(adminTechniciansSrc).toMatch(/onClick=\{\(\) => \(tech\.completedTasksList\?\.length \|\| 0\) > 0 \? setModal\(\{ tech, type: "completed" \}\) : undefined\}/);
    expect(adminTechniciansSrc).toMatch(/onClick=\{\(\) => \(tech\.postponedTasksList\?\.length \|\| 0\) > 0 \? setModal\(\{ tech, type: "postponed" \}\) : undefined\}/);
    expect(adminTechniciansSrc).toMatch(/\{tech\.completedTasks \|\| 0\}/);
    expect(adminTechniciansSrc).toMatch(/\{tech\.postponedTasks \|\| 0\}/);
    expect(adminTechniciansSrc).toMatch(/\{tech\.pendingTasks \|\| 0\}/);
  });
  it('4/5. the new wrapper uses no direction-specific (LTR-only) styling -- mx-auto centers identically in Arabic RTL and English LTR', () => {
    const wrapperMatch = adminTechniciansSrc.match(/\{\/\* Technician cards grid[\s\S]*?<div className="max-w-5xl mx-auto">/)?.[0] || '';
    expect(wrapperMatch).not.toMatch(/dir="ltr"|text-left|ml-auto(?!\s*mr-auto)/);
  });
});

describe('Part B: Customer.previousService schema + backend', () => {
  it('schema: all three previousService* fields are nullable (existing customers stay valid)', () => {
    expect(schemaPrisma).toMatch(/previousServiceType\s+String\?/);
    expect(schemaPrisma).toMatch(/previousServiceDate\s+DateTime\?/);
    expect(schemaPrisma).toMatch(/previousServiceNote\s+String\?/);
  });
  it('9/10/11: resolvePreviousService enforces the all-or-nothing rule and a valid-type whitelist', () => {
    expect(backendCustomersSrc).toMatch(/const PREVIOUS_SERVICE_TYPES = \['INSTALLATION', 'MAINTENANCE'\]/);
    expect(backendCustomersSrc).toMatch(/if \(!effectiveType\) return \{ error: 'نوع الخدمة السابقة مطلوب/);
    expect(backendCustomersSrc).toMatch(/if \(!effectiveDateRaw\) return \{ error: 'تاريخ الخدمة السابقة مطلوب/);
  });
  it('reuses one resolvePreviousService() helper for both create and update, not duplicated logic', () => {
    const declarations = backendCustomersSrc.match(/function resolvePreviousService/g) || [];
    expect(declarations.length).toBe(1);
    // 1 declaration + exactly 2 call sites (POST create, PUT update).
    const allOccurrences = backendCustomersSrc.match(/resolvePreviousService\(/g) || [];
    expect(allOccurrences.length).toBe(3);
  });
  it('22: no Appointment creation anywhere near the previous-service resolution/persistence code', () => {
    const fnBlock = backendCustomersSrc.match(/function resolvePreviousService[\s\S]*?\n\}/)?.[0] || '';
    expect(fnBlock).not.toMatch(/appointment/i);
  });
});

describe('Part B: Customer create forms (Admin + Scheduling) expose the optional Previous Service section', () => {
  for (const [label, src] of [['Admin', adminAddCustomerSrc], ['Scheduling', schedAddCustomerSrc]] as const) {
    it(`${label}: renders the Previous Service type dropdown with exactly the two required options`, () => {
      expect(src).toMatch(/t\("customers\.previousService"\)/);
      expect(src).toMatch(/<option value="INSTALLATION">\{t\("customers\.previousInstallation"\)\}<\/option>/);
      expect(src).toMatch(/<option value="MAINTENANCE">\{t\("customers\.previousMaintenance"\)\}<\/option>/);
    });
    it(`${label}: 13/14. the service date field is a native date-only picker -- no time input, matching the project's date-picker-only convention`, () => {
      expect(src).toMatch(/type="date" lang="en-GB" dir="ltr" value=\{form\.previousServiceDate\}/);
      expect(src).not.toMatch(/previousServiceDate[\s\S]{0,80}type="time"/);
    });
    it(`${label}: date is normalized through the shared dateOnlyToApiDate() helper, not fabricated locally`, () => {
      expect(src).toMatch(/import \{ dateOnlyToApiDate \} from "\.\.\/\.\.\/utils\/dateTimeInput";/);
      expect(src).toMatch(/dateOnlyToApiDate\(previousServiceDate\)/);
    });
    it(`${label}: type and date become required only once any previous-service field has content (all-or-nothing, note stays optional)`, () => {
      expect(src).toMatch(/const hasAnyPreviousService = !!form\.previousServiceType \|\| !!form\.previousServiceDate \|\| !!form\.previousServiceNote\.trim\(\);/);
      expect(src).toMatch(/if \(hasAnyPreviousService\) \{/);
    });
  }
});

describe('i18n: Previous Service labels exist in both languages with the exact requested wording', () => {
  it('customers.previousService / previousInstallation / previousMaintenance match the exact requested Arabic labels', () => {
    expect(i18n.getFixedT('ar')('customers.previousService')).toBe('الخدمة السابقة');
    expect(i18n.getFixedT('ar')('customers.previousInstallation')).toBe('تركيب سابق');
    expect(i18n.getFixedT('ar')('customers.previousMaintenance')).toBe('صيانة سابقة');
    expect(i18n.getFixedT('en')('customers.previousService')).toBe('Previous Service');
    expect(i18n.getFixedT('en')('customers.previousInstallation')).toBe('Previous Installation');
    expect(i18n.getFixedT('en')('customers.previousMaintenance')).toBe('Previous Maintenance');
  });
});

describe('16/18: Admin customer details (CustomerDetail.tsx) show previous-service data only when present', () => {
  it('the on-screen view conditionally renders the whole previous-service block, never an empty section', () => {
    expect(adminCustomerDetailSrc).toMatch(/\{c\.previousServiceType && \(/);
  });
  it('the PDF export conditionally includes a previous-service section', () => {
    expect(adminCustomerDetailSrc).toMatch(/\$\{c\.previousServiceType \? `<div class="sec">/);
  });
});

describe('17/18: Scheduling/Maintenance customer details (CustomerList.tsx HistoryModal) show previous-service data only when present', () => {
  it('conditionally renders the previous-service block, never an empty row', () => {
    expect(schedCustomerListSrc).toMatch(/\{customer\.previousServiceType && \(/);
  });
});
