// Source-level regression tests for Modification #10: the Admin-only
// "Appointment Acceptance" sidebar item and dedicated page. Follows this
// project's established pattern for full-page components that call
// useQuery/useMutation/useSocket directly (see appointmentExport.test.ts,
// appointmentAcceptance.test.ts on the backend) -- source-level assertions
// instead of rebuilding the full router/api-client/provider stack.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import i18n from '../../unified-app/src/i18n';

const adminSidebarSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/admin/components/Sidebar.tsx'), 'utf-8');
const schedSidebarSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/scheduling/components/Sidebar.tsx'), 'utf-8');
const techSidebarSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/technician/components/Sidebar.tsx'), 'utf-8');
// Normalized to LF: this file is edited across sessions where git's
// core.autocrlf can rewrite it to CRLF on checkout, which would otherwise
// silently break the literal "\n\n"-based block-boundary regexes below.
const appSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/App.tsx'), 'utf-8').replace(/\r\n/g, '\n');
const layoutSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/admin/components/Layout.tsx'), 'utf-8');
const pageSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/admin/pages/AppointmentAcceptance.tsx'), 'utf-8');

describe('i18n: exact required labels', () => {
  it('nav.appointmentAcceptance matches the required Arabic/English wording', () => {
    expect(i18n.getFixedT('ar')('nav.appointmentAcceptance')).toBe('قبول الموعد');
    expect(i18n.getFixedT('en')('nav.appointmentAcceptance')).toBe('Appointment Acceptance');
  });
  it('appointments.noAppointmentsAwaitingApproval matches the required Arabic/English wording', () => {
    expect(i18n.getFixedT('ar')('appointments.noAppointmentsAwaitingApproval')).toBe('لا توجد مواعيد بانتظار القبول');
    expect(i18n.getFixedT('en')('appointments.noAppointmentsAwaitingApproval')).toBe('No appointments awaiting approval');
  });
});

describe('Sidebar visibility: Admin only', () => {
  it('the Admin sidebar includes the Appointment Acceptance nav item', () => {
    expect(adminSidebarSrc).toMatch(/to:\s*"\/admin\/appointment-acceptance"/);
    expect(adminSidebarSrc).toMatch(/label:\s*"nav\.appointmentAcceptance"/);
  });

  it('the Scheduling sidebar does not reference Appointment Acceptance at all', () => {
    expect(schedSidebarSrc).not.toMatch(/appointment-acceptance/);
    expect(schedSidebarSrc).not.toMatch(/appointmentAcceptance/);
  });

  it('the Technician sidebar does not reference Appointment Acceptance at all', () => {
    expect(techSidebarSrc).not.toMatch(/appointment-acceptance/);
    expect(techSidebarSrc).not.toMatch(/appointmentAcceptance/);
  });
});

describe('Routing: Admin-only guarded route', () => {
  it('the route is registered inside the AdminGuard-protected /admin route tree', () => {
    const adminBlockMatch = appSrc.match(/<Route path="\/admin" element=\{<AdminGuard>[\s\S]*?<\/Route>\n\n {10}<Route path="\/scheduling"/);
    expect(adminBlockMatch).toBeTruthy();
    expect(adminBlockMatch![0]).toMatch(/path="appointment-acceptance" element=\{<AppointmentAcceptance \/>\}/);
  });

  it('is not registered under the Scheduling or Technician route trees', () => {
    const schedBlockMatch = appSrc.match(/<Route path="\/scheduling"[\s\S]*?<\/Route>\n\n {10}<Route path="\/technician"/);
    const techBlockMatch = appSrc.match(/<Route path="\/technician"[\s\S]*?<\/Route>\n\n {10}<Route path="\*"/);
    expect(schedBlockMatch![0]).not.toMatch(/appointment-acceptance/);
    expect(techBlockMatch![0]).not.toMatch(/appointment-acceptance/);
  });

  it('the header title map resolves the new route to the correct nav label', () => {
    expect(layoutSrc).toMatch(/"\/admin\/appointment-acceptance":\s*"nav\.appointmentAcceptance"/);
  });
});

describe('AppointmentAcceptance page', () => {
  it('fetches the dedicated pending-export-approval endpoint (not the general appointments list)', () => {
    expect(pageSrc).toMatch(/api\.get\("\/appointments\/pending-export-approval"\)/);
  });

  it('approves using the exact Modification #5 backend action', () => {
    expect(pageSrc).toMatch(/api\.patch\(`\/appointments\/\$\{id\}\/approve-export`\)/);
  });

  it('invalidates the pending list on successful approval (removes the item without a full reload)', () => {
    expect(pageSrc).toMatch(/qc\.invalidateQueries\(\{ queryKey: \["pending-export-approval"\] \}\)/);
  });

  it('listens for the existing appointment:status realtime event to stay in sync (no new socket event invented)', () => {
    expect(pageSrc).toMatch(/socket\.on\("appointment:status", refresh\)/);
  });

  it('renders a clean loading state, error state, and empty state', () => {
    expect(pageSrc).toMatch(/isLoading \? \(/);
    expect(pageSrc).toMatch(/isError \? \(/);
    expect(pageSrc).toMatch(/appointments\.length === 0 \? \(/);
    expect(pageSrc).toMatch(/t\("appointments\.noAppointmentsAwaitingApproval"\)/);
  });

  it('disables only the specific row being approved (per-row double-submit prevention)', () => {
    expect(pageSrc).toMatch(/const approving = approveMutation\.isPending && approveMutation\.variables === a\.id;/);
    expect(pageSrc).toMatch(/disabled=\{approving\}/);
  });

  it('does not implement a reject/decline flow', () => {
    expect(pageSrc.toLowerCase()).not.toMatch(/reject/);
    expect(pageSrc.toLowerCase()).not.toMatch(/decline/);
  });

  it('displays customer, service type, date, location, technician, and notes -- but never completionAmount', () => {
    expect(pageSrc).toMatch(/a\.customer\?\.name/);
    expect(pageSrc).toMatch(/a\.type === "INSTALLATION"/);
    expect(pageSrc).toMatch(/a\.scheduledDate/);
    expect(pageSrc).toMatch(/addr\.city/);
    expect(pageSrc).toMatch(/a\.technician\?\.name/);
    expect(pageSrc).toMatch(/a\.notes/);
    expect(pageSrc).not.toMatch(/completionAmount/);
  });
});
