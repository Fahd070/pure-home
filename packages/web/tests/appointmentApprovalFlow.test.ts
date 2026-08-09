// Approval-flow fix: source-level confirmation that every active appointment-
// creation call site (Scheduling's primary New Appointment screen, Scheduling
// Dashboard quick-schedule, Scheduling CustomerList quick-schedule, Admin's
// Dashboard quick-schedule, Admin Appointments, Admin UrgentAppointments) all
// funnel through the same single POST /appointments backend endpoint and
// never attempt to send visibleToTechnician/adminApproved themselves -- the
// creator-role rule is enforced once, server-side, for every one of these
// forms simultaneously (backend behavior itself is covered end-to-end in
// appointmentApprovalFlow.test.ts on the backend).
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const CREATION_SITES = [
  'scheduling/pages/NewAppointment.tsx',
  'scheduling/pages/Dashboard.tsx',
  'scheduling/pages/CustomerList.tsx',
  'admin/pages/Dashboard.tsx',
  'admin/pages/Appointments.tsx',
  'admin/pages/UrgentAppointments.tsx',
];

describe('Appointment creation call sites: no client-supplied approval flags', () => {
  for (const relPath of CREATION_SITES) {
    it(`${relPath} posts to /appointments without ASSIGNING visibleToTechnician or adminApproved in the payload`, () => {
      const src = fs.readFileSync(path.resolve(__dirname, `../../unified-app/src/${relPath}`), 'utf-8');
      expect(src).toMatch(/post\("\/appointments"/);
      // Property ASSIGNMENT (e.g. `visibleToTechnician: true` in a create-body
      // literal) is what would matter -- some of these files legitimately read
      // (`a.adminApproved`) these fields elsewhere for unrelated display
      // purposes (e.g. admin/pages/Appointments.tsx's existing approve-export
      // button), which is not a client-supplied-override risk.
      expect(src).not.toMatch(/visibleToTechnician\s*:/);
      expect(src).not.toMatch(/adminApproved\s*:/);
    });
  }
});

describe('Admin AppointmentAcceptance: realtime refresh for appointments that start pending at creation', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/admin/pages/AppointmentAcceptance.tsx'), 'utf-8');

  it('listens for appointment:created in addition to the existing appointment:status, so a Scheduling-created appointment (pending from the moment it is created) appears live', () => {
    expect(src).toMatch(/socket\.on\("appointment:status",\s*refresh\)/);
    expect(src).toMatch(/socket\.on\("appointment:created",\s*refresh\)/);
  });

  it('cleans up both listeners on unmount', () => {
    expect(src).toMatch(/socket\.off\("appointment:status",\s*refresh\)/);
    expect(src).toMatch(/socket\.off\("appointment:created",\s*refresh\)/);
  });
});

describe('Backend: creator-role rule wired at the source level (regression confirmation)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../backend/src/routes/appointments.ts'), 'utf-8');

  it('visibleToTechnician at creation is derived from isAdmin/isUrgent, never a hardcoded true', () => {
    expect(src).toMatch(/visibleToTechnician:\s*isAdmin \|\| isUrgent,/);
  });
});
