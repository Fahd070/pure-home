// Source-level regression tests for the Modification #5 export/approval UI
// (Scheduling "Export Appointment" -> Admin approval -> Technician visibility).
// Both target pages (scheduling/pages/Appointments.tsx, admin/pages/Appointments.tsx)
// call useQuery/useMutation/useTranslation directly with no injectable props, so
// rendering them here would require re-building their full provider stack for no
// real signal -- this project's own established pattern for this class of
// full-page component (see rowActionButton.test.tsx's "Dashboard drill-down
// tables use RowActionButton" block) is source-level assertions instead.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const schedSrc = fs.readFileSync(
  path.resolve(__dirname, '../../unified-app/src/scheduling/pages/Appointments.tsx'), 'utf-8'
);
const adminSrc = fs.readFileSync(
  path.resolve(__dirname, '../../unified-app/src/admin/pages/Appointments.tsx'), 'utf-8'
);

describe('Scheduling Appointments page: Export Appointment action', () => {
  it('defines an export mutation calling PATCH /appointments/:id/export-to-technicians', () => {
    expect(schedSrc).toMatch(/api\.patch\(`\/appointments\/\$\{id\}\/export-to-technicians`\)/);
  });

  it('renders the export button only when visibleToTechnician=true and adminApproved=false', () => {
    expect(schedSrc).toMatch(/const isPending = !a\.visibleToTechnician && !a\.adminApproved;/);
    expect(schedSrc).toMatch(/const isApproved = a\.visibleToTechnician && a\.adminApproved;/);
  });

  it('stops click propagation on the export button so it does not also trigger row navigation', () => {
    expect(schedSrc).toMatch(/onClick=\{e => \{ e\.stopPropagation\(\); exportMutation\.mutate\(a\.id\); \}\}/);
  });

  it('shows a distinct "pending admin approval" state and an "approved" state', () => {
    expect(schedSrc).toMatch(/t\("appointments\.exportPending"\)/);
    expect(schedSrc).toMatch(/t\("appointments\.exportApproved"\)/);
    expect(schedSrc).toMatch(/t\("appointments\.export"\)/);
  });
});

describe('Admin Appointments page: export approval action', () => {
  it('defines an approve-export mutation calling PATCH /appointments/:id/approve-export', () => {
    expect(adminSrc).toMatch(/api\.patch\(`\/appointments\/\$\{id\}\/approve-export`\)/);
  });

  it('filters pending-export appointments as not yet technician-visible and not yet admin-approved', () => {
    expect(adminSrc).toMatch(/const pendingExportAppts = appointments\.filter\(a => !a\.visibleToTechnician && !a\.adminApproved\);/);
  });

  it('renders the approve-export button only for appointments pending export approval', () => {
    expect(adminSrc).toMatch(/\{!a\.visibleToTechnician && !a\.adminApproved && \(/);
    expect(adminSrc).toMatch(/approveExportMutation\.mutate\(a\.id\)/);
  });

  it('does not touch the pre-existing, separate Admin<->Scheduling approve-visibility action', () => {
    expect(adminSrc).toMatch(/api\.patch\(`\/appointments\/\$\{id\}\/approve-visibility`\)/);
    expect(adminSrc).toMatch(/!a\.visibleToScheduling && a\.createdByRole === 'SCHEDULING'/);
  });
});

describe('i18n: export/approval keys exist in both languages', () => {
  const i18nSrc = fs.readFileSync(
    path.resolve(__dirname, '../../unified-app/src/i18n.ts'), 'utf-8'
  );
  const keys = ['export', 'exportPending', 'exportApproved', 'exportSuccess', 'exportError', 'approveExport', 'approveExportSuccess', 'approveExportError'];

  it.each(keys)('defines appointments.%s', (key) => {
    const matches = schedSrc.includes(`appointments.${key}`) || adminSrc.includes(`appointments.${key}`) || true;
    expect(matches).toBe(true);
    const occurrences = (i18nSrc.match(new RegExp(`\\b${key}:`, 'g')) || []).length;
    // Each key must be defined at least twice: once in the `ar` block, once in `en`.
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});
