// Customer deletion synchronization (Part A) and Dashboard counter sync
// (Part B). The backend fix (customerDeletionSync.test.ts,
// dashboardCounterSync.test.ts on the backend) is a root-cause, server-side
// change only: the frontend's React Query invalidation + Socket.IO refresh
// on `customer:deleted`/`appointment:deleted`/`customers:bulk-deleted` for
// both the Admin and Scheduling dashboards, and for the Technician Work
// Queue, was already implemented by a prior modification and needed no
// change -- these listeners refresh unconditionally (they never inspect the
// event payload), so they pick up the corrected backend data automatically.
// These are permanent regression tests locking in that existing wiring,
// source-level per this project's established pattern for full-page
// components (see maintenanceConfirmation.test.ts).
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const adminDashboardSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/admin/pages/Dashboard.tsx'), 'utf-8');
const schedDashboardSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/scheduling/pages/Dashboard.tsx'), 'utf-8');
const workQueueSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/technician/pages/WorkQueue.tsx'), 'utf-8');

describe('Admin Dashboard: realtime refresh + query invalidation on deletion (unchanged, pre-existing)', () => {
  it('fetches dashboard-stats from the fixed GET /dashboard/stats endpoint', () => {
    expect(adminDashboardSrc).toMatch(/queryKey:\s*\["dashboard-stats"\]/);
    expect(adminDashboardSrc).toMatch(/api\.get\("\/dashboard\/stats"\)/);
  });

  it('listens for customer:deleted, appointment:deleted, and customers:bulk-deleted', () => {
    expect(adminDashboardSrc).toMatch(/socket\.on\("appointment:deleted",\s*refresh\)/);
    expect(adminDashboardSrc).toMatch(/socket\.on\("customer:deleted",\s*refresh\)/);
    expect(adminDashboardSrc).toMatch(/socket\.on\("customers:bulk-deleted",\s*refresh\)/);
  });

  it('the refresh handler invalidates dashboard-stats (no manual reload)', () => {
    expect(adminDashboardSrc).toMatch(/qc\.invalidateQueries\(\{ queryKey: \["dashboard-stats"\] \}\)/);
    expect(adminDashboardSrc).not.toMatch(/window\.location\.reload/);
  });

  it("the drill-down modal's delete button targets the fixed DELETE /dashboard/:type/:id route", () => {
    expect(adminDashboardSrc).toMatch(/api\.delete\(`\/dashboard\/\$\{type\}\/\$\{id\}`\)/);
    expect(adminDashboardSrc).toMatch(/qc\.invalidateQueries\(\{ queryKey: \["dashboard-drill", endpoint\] \}\)/);
  });
});

describe('Scheduling Dashboard: realtime refresh + query invalidation on deletion (unchanged, pre-existing)', () => {
  it('fetches sched-dashboard-stats from the same fixed GET /dashboard/stats endpoint', () => {
    expect(schedDashboardSrc).toMatch(/queryKey:\s*\["sched-dashboard-stats"\]/);
    expect(schedDashboardSrc).toMatch(/api\.get\("\/dashboard\/stats"\)/);
  });

  it('listens for customer:deleted, appointment:deleted, and customers:bulk-deleted', () => {
    expect(schedDashboardSrc).toMatch(/socket\.on\("appointment:deleted",\s*refresh\)/);
    expect(schedDashboardSrc).toMatch(/socket\.on\("customer:deleted",\s*refresh\)/);
    expect(schedDashboardSrc).toMatch(/socket\.on\("customers:bulk-deleted",\s*refresh\)/);
  });

  it('the refresh handler invalidates sched-dashboard-stats (no manual reload)', () => {
    expect(schedDashboardSrc).toMatch(/qc\.invalidateQueries\(\{ queryKey: \["sched-dashboard-stats"\] \}\)/);
    expect(schedDashboardSrc).not.toMatch(/window\.location\.reload/);
  });
});

describe('Technician Work Queue: refreshes on deletion so a cleaned-up appointment disappears (unchanged, pre-existing)', () => {
  it('listens for appointment:deleted and customer:deleted', () => {
    expect(workQueueSrc).toMatch(/socket\.on\("appointment:deleted",\s*refresh\)/);
    expect(workQueueSrc).toMatch(/socket\.on\("customer:deleted",\s*refresh\)/);
  });

  it('does not rely on a manual page reload', () => {
    expect(workQueueSrc).not.toMatch(/window\.location\.reload/);
  });
});
