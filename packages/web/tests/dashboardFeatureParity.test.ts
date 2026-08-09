// Dashboard feature-parity fix: compares the Admin and Scheduling Dashboards
// (both packages/unified-app/src/{admin,scheduling}/pages/Dashboard.tsx) for
// the specific gaps identified by inspection -- Admin was missing the
// Modification #11 Call Report shortcut it is already authorized for
// (POST/GET /call-reports are requireRole('ADMIN','SCHEDULING')), and
// Scheduling's drill-down table was missing the appointment "type" column and
// the colored workStatus badge Admin's already had. Admin-only capabilities
// (row delete, Recent Activity dismiss/clear-all -- all backend-enforced
// requireRole('ADMIN') on their routes) and Scheduling-only responsibilities
// remain intentionally un-synchronized; see dashboardCounterSync.test.ts /
// dashboardDeletionSync.test.ts for the deletion/counter-sync regressions
// this batch must not disturb.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import i18n from '../../unified-app/src/i18n';

const adminSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/admin/pages/Dashboard.tsx'), 'utf-8');
const schedSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/scheduling/pages/Dashboard.tsx'), 'utf-8');

describe('Call Report shortcut parity: Admin now has the same authorized shortcut as Scheduling', () => {
  it('Admin Dashboard imports and wires CallReportModal, guarded on a real customer (matching Scheduling)', () => {
    expect(adminSrc).toMatch(/import CallReportModal from "\.\.\/components\/CallReportModal"/);
    expect(adminSrc).toMatch(/const \[callReportCustomer, setCallReportCustomer\] = useState/);
    expect(adminSrc).toMatch(/\{a\.customer && \(/);
    expect(adminSrc).toMatch(/variant="call"/);
    expect(adminSrc).toMatch(/setCallReportCustomer\(\{ id: a\.customer\.id, name: a\.customer\.name, phone: a\.customer\.phone \}\)/);
  });

  it('Admin has its own CallReportForm/CallReportModal pointed at Admin\'s own api client and auth store (not a cross-department import)', () => {
    const formSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/admin/components/CallReportForm.tsx'), 'utf-8');
    expect(formSrc).toMatch(/import \{ api \} from "\.\.\/api\/client"/);
    expect(formSrc).toMatch(/import \{ useAuthStore \} from "\.\.\/store\/authStore"/);
    expect(formSrc).toMatch(/api\.post\("\/call-reports", body\)/);
  });

  it('Admin\'s standalone Call Reports page now reuses the extracted CallReportForm (single source of truth, matching Modification #11\'s Scheduling precedent)', () => {
    const pageSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/admin/pages/CallReports.tsx'), 'utf-8');
    expect(pageSrc).toMatch(/import CallReportForm from "\.\.\/components\/CallReportForm"/);
    expect(pageSrc).toMatch(/<CallReportForm onSaved=\{\(\) => setShowForm\(false\)\} onCancel=\{\(\) => setShowForm\(false\)\} \/>/);
    expect(pageSrc).not.toMatch(/const createMutation = useMutation/);
  });

  it('i18n: callReports.action wording is available for the Admin shortcut too (same key, no duplication)', () => {
    expect(i18n.getFixedT('ar')('callReports.action')).toBe('تقرير المكالمة');
    expect(i18n.getFixedT('en')('callReports.action')).toBe('Call Report');
  });
});

describe('Shared appointment drill-down display parity', () => {
  it('both dashboards show the appointment type column in the drill-down table', () => {
    expect(adminSrc).toMatch(/\{t\("appointments\.type"\)\}/);
    expect(schedSrc).toMatch(/\{t\("appointments\.type"\)\}/);
  });

  it('both dashboards render a colored workStatus badge using the same taskColors mapping', () => {
    for (const src of [adminSrc, schedSrc]) {
      expect(src).toMatch(/WAITING:\s*"bg-yellow-100 text-yellow-700"/);
      expect(src).toMatch(/IN_PROGRESS:\s*"bg-indigo-100 text-indigo-700"/);
      expect(src).toMatch(/COMPLETED:\s*"bg-green-100 text-green-700"/);
      expect(src).toMatch(/POSTPONED:\s*"bg-orange-100 text-orange-700"/);
    }
  });

  it('both dashboards show the same 8 stat cards in the same order', () => {
    const cardOrderRe = /key:\s*"total"[\s\S]*?key:\s*"completed"[\s\S]*?key:\s*"thisMonth"[\s\S]*?key:\s*"nextMonth"[\s\S]*?key:\s*"todayCount"[\s\S]*?key:\s*"pending"[\s\S]*?key:\s*"pendingApproval"[\s\S]*?key:\s*"urgentCount"/;
    expect(adminSrc).toMatch(cardOrderRe);
    expect(schedSrc).toMatch(cardOrderRe);
  });

  it('both dashboards use the same responsive card grid', () => {
    expect(adminSrc).toMatch(/grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4/);
    expect(schedSrc).toMatch(/grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4/);
  });
});

describe('Admin-only capabilities remain Admin-only (not synchronized to Scheduling)', () => {
  it('only Admin\'s Dashboard has customer/appointment row delete', () => {
    expect(adminSrc).toMatch(/variant="delete"/);
    expect(schedSrc).not.toMatch(/variant="delete"/);
  });

  it('only Admin\'s Dashboard has Recent Activity dismiss/clear-all (both backend routes are requireRole(\'ADMIN\'))', () => {
    expect(adminSrc).toMatch(/deleteActivity/);
    expect(adminSrc).toMatch(/clearAllActivity/);
    expect(schedSrc).not.toMatch(/deleteActivity/);
    expect(schedSrc).not.toMatch(/clearAllActivity/);
  });

  it('Appointment Acceptance is not referenced anywhere in the Scheduling Dashboard', () => {
    expect(schedSrc).not.toMatch(/pending-export-approval/);
    expect(schedSrc).not.toMatch(/approve-export/);
  });

  it('neither dashboard exposes completionAmount/completionPaymentMethod (Modification #6 privacy unaffected)', () => {
    expect(adminSrc).not.toMatch(/completionAmount/);
    expect(adminSrc).not.toMatch(/completionPaymentMethod/);
    expect(schedSrc).not.toMatch(/completionAmount/);
    expect(schedSrc).not.toMatch(/completionPaymentMethod/);
  });

  it('Modification #8 Confirm Operation is not present in either Dashboard (Scheduling-only responsibility, not a Dashboard feature)', () => {
    expect(adminSrc).not.toMatch(/confirm-operation/);
    expect(schedSrc).not.toMatch(/confirm-operation/);
  });
});
