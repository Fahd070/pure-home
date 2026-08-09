// Source-level regression tests for Modification #9: pending (WAITING)
// Technician cards/detail must show customer, service, date/time, location,
// notes, and assignment status without requiring Start/Complete. Root cause was
// purely frontend (WorkQueue.tsx/TaskDetail.tsx not rendering already-available
// fields) -- no backend change was needed, so these tests focus on confirming
// the UI now renders what the API already returns, and that viewing never
// triggers a state-changing mutation. Follows this project's established
// source-level pattern for full-page components (see appointmentExport.test.ts,
// maintenanceConfirmation.test.ts) since WorkQueue/TaskDetail call
// useQuery/useSocket/useNavigate directly with no injectable props.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import i18n from '../../unified-app/src/i18n';

const workQueueSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/technician/pages/WorkQueue.tsx'), 'utf-8');
const taskDetailSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/technician/pages/TaskDetail.tsx'), 'utf-8');

describe('i18n: tasks.unassigned exact wording', () => {
  it('matches the required Arabic/English wording', () => {
    expect(i18n.getFixedT('ar')('tasks.unassigned')).toBe('غير مخصص');
    expect(i18n.getFixedT('en')('tasks.unassigned')).toBe('Unassigned');
  });
});

describe('WorkQueue card: pending task details', () => {
  it('displays customer name and phone', () => {
    expect(workQueueSrc).toMatch(/\{customer\?\.name\}/);
    expect(workQueueSrc).toMatch(/\{customer\?\.phone\}/);
  });

  it('displays a localized status badge for the pending/in-progress state', () => {
    expect(workQueueSrc).toMatch(/statusLabel\[appt\.workStatus\] \|\| appt\.workStatus/);
  });

  it('displays the location/address block when present', () => {
    expect(workQueueSrc).toMatch(/\{addr && \(/);
    expect(workQueueSrc).toMatch(/addr\.city/);
    expect(workQueueSrc).toMatch(/addr\.district/);
  });

  it('displays service type and the full scheduled date+time (not date-only)', () => {
    expect(workQueueSrc).toMatch(/appt\.type === "INSTALLATION"/);
    expect(workQueueSrc).toMatch(/new Date\(appt\.scheduledDate\)\.toLocaleString\(/);
    expect(workQueueSrc).not.toMatch(/new Date\(appt\.scheduledDate\)\.toLocaleDateString\(\)/);
  });

  it('shows an appointment-notes preview when notes are present', () => {
    expect(workQueueSrc).toMatch(/\{appt\.notes && \(/);
    expect(workQueueSrc).toMatch(/t\("common\.notes"\)/);
  });

  it('shows an Unassigned badge only for a pool task with no technicianId', () => {
    expect(workQueueSrc).toMatch(/\{!appt\.technicianId && \(/);
    expect(workQueueSrc).toMatch(/t\("tasks\.unassigned"\)/);
  });

  it('cards remain clickable/navigable to the detail page (unchanged)', () => {
    expect(workQueueSrc).toMatch(/onClick=\{\(\) => navigate\(`\/technician\/queue\/\$\{appt\.id\}`\)\}/);
  });

  it('still excludes urgent appointments from this list (unchanged Modification-era rule -- urgent has its own dedicated page)', () => {
    expect(workQueueSrc).toMatch(/!appt\.isUrgent/);
  });
});

describe('TaskDetail: full pending-detail view', () => {
  it('displays appointment notes when present', () => {
    expect(taskDetailSrc).toMatch(/\{appt\?\.notes && \(/);
    expect(taskDetailSrc).toMatch(/appt\.notes/);
  });

  it('displays the full scheduled date+time, not date-only', () => {
    expect(taskDetailSrc).toMatch(/new Date\(appt\?\.scheduledDate\)\.toLocaleString\(/);
  });

  it('displays a localized service type instead of the raw enum value', () => {
    expect(taskDetailSrc).toMatch(/appt\?\.type === "INSTALLATION" \? t\("appointments\.installation"\) : t\("appointments\.maintenance"\)/);
  });

  it('displays a localized status label instead of the raw workStatus enum value', () => {
    expect(taskDetailSrc).toMatch(/statusLabel\[workStatus\] \|\| workStatus/);
  });

  it('shows an Unassigned badge only for a pool task with no technicianId', () => {
    expect(taskDetailSrc).toMatch(/\{!appt\?\.technicianId && \(/);
    expect(taskDetailSrc).toMatch(/t\("tasks\.unassigned"\)/);
  });

  it('still handles the urgent-location fallback for a customerless (urgent) appointment (unchanged)', () => {
    expect(taskDetailSrc).toMatch(/!customer && appt\?\.urgentLocation/);
  });

  it('still shows the address block when present (unchanged)', () => {
    expect(taskDetailSrc).toMatch(/\{addr && \(/);
  });
});

describe('TaskDetail: viewing a pending task never triggers a state-changing mutation', () => {
  it('start.mutate() is only invoked from the Start button\'s onClick, never automatically on load', () => {
    // No effect/top-level call -- the only occurrence of "start.mutate(" must be
    // inside the WAITING-state button's onClick handler.
    const occurrences = (taskDetailSrc.match(/start\.mutate\(\)/g) || []).length;
    expect(occurrences).toBe(1);
    expect(taskDetailSrc).toMatch(/onClick=\{\(\) => start\.mutate\(\)\}/);
    expect(taskDetailSrc).not.toMatch(/useEffect\([^)]*start\.mutate/);
  });

  it('complete.mutate() is only invoked from the completion modal\'s Save button, never automatically on load', () => {
    const occurrences = (taskDetailSrc.match(/complete\.mutate\(\)/g) || []).length;
    expect(occurrences).toBe(1);
    expect(taskDetailSrc).toMatch(/onClick=\{\(\) => complete\.mutate\(\)\}/);
    expect(taskDetailSrc).not.toMatch(/useEffect\([^)]*complete\.mutate/);
  });

  it('fetching the appointment (useQuery) is read-only -- the GET call has no side-effecting onSuccess that mutates status', () => {
    expect(taskDetailSrc).toMatch(/queryFn: \(\) => api\.get\(`\/appointments\/\$\{id\}`\)\.then\(r => r\.data\.data\)/);
  });
});

describe('Modification #8 completion fields are untouched by this modification', () => {
  it('the completion form still includes actualCompletionDate, nextMaintenanceNote, and the required-field validation', () => {
    expect(taskDetailSrc).toMatch(/actualCompletionDate:\s*""/);
    expect(taskDetailSrc).toMatch(/nextMaintenanceNote:\s*""/);
    expect(taskDetailSrc).toMatch(/!!completeForm\.actualCompletionDate/);
  });
});
