// v4 Requirement #4: the automatic maintenance-due engine.
//
// Split into pure-domain tests (no database) and materialization tests (the
// stored nextMaintenanceDueAt column staying in step with real mutations).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, TestUsers, testPhone, uniqueSuffix } from './helpers/fixtures';
import prisma from '../src/prisma';
import {
  computeNextMaintenanceDate,
  calculateNextMaintenanceDate,
  getMaintenancePriority,
  describeMaintenanceDue,
  daysUntilDue,
  DUE_SOON_DAYS,
} from '../src/services/maintenanceSchedule.service';
import { recalculateCustomerMaintenanceDue } from '../src/services/maintenanceDue.service';

const MONTHLY = 'MONTHLY' as const;

describe('Maintenance due engine — pure domain', () => {
  const noAppointments: any[] = [];

  it('uses the most recent completed maintenance as the baseline', () => {
    const due = computeNextMaintenanceDate(
      { maintenanceCycle: MONTHLY, maintenanceFrequency: 3, previousServiceDate: null, installationDate: new Date('2020-01-01') },
      [
        { isUrgent: false, workStatus: 'COMPLETED', actualCompletionDate: new Date('2026-01-10'), completedAt: null, scheduledDate: new Date('2026-01-09') },
        { isUrgent: false, workStatus: 'COMPLETED', actualCompletionDate: new Date('2026-04-10'), completedAt: null, scheduledDate: new Date('2026-04-09') },
      ]
    );
    // Newest completion (April) + 3 months, NOT the January one and not the
    // installation date.
    expect(due!.toISOString().slice(0, 10)).toBe('2026-07-10');
  });

  it('falls back to previousServiceDate when there is no completion', () => {
    const due = computeNextMaintenanceDate(
      { maintenanceCycle: MONTHLY, maintenanceFrequency: 2, previousServiceDate: new Date('2026-03-15'), installationDate: new Date('2020-01-01') },
      noAppointments
    );
    expect(due!.toISOString().slice(0, 10)).toBe('2026-05-15');
  });

  it('falls back to installationDate when there is neither — the Requirement #4 gap', () => {
    // Before this fallback existed, this customer had NO computable due date at
    // all and was therefore invisible to every due list and dashboard bucket.
    const due = computeNextMaintenanceDate(
      { maintenanceCycle: MONTHLY, maintenanceFrequency: 6, previousServiceDate: null, installationDate: new Date('2026-01-31') },
      noAppointments
    );
    expect(due).not.toBeNull();
    expect(due!.toISOString().slice(0, 10)).toBe('2026-07-31');
  });

  it('returns null — never a fabricated date — when no baseline exists at all', () => {
    const due = computeNextMaintenanceDate(
      { maintenanceCycle: MONTHLY, maintenanceFrequency: 3, previousServiceDate: null, installationDate: null },
      noAppointments
    );
    expect(due).toBeNull();
  });

  it('ignores urgent visits and non-completed appointments as baselines', () => {
    const due = computeNextMaintenanceDate(
      { maintenanceCycle: MONTHLY, maintenanceFrequency: 1, previousServiceDate: null, installationDate: new Date('2026-01-01') },
      [
        { isUrgent: true, workStatus: 'COMPLETED', actualCompletionDate: new Date('2026-06-01'), completedAt: null, scheduledDate: new Date('2026-06-01') },
        { isUrgent: false, workStatus: 'WAITING', actualCompletionDate: null, completedAt: null, scheduledDate: new Date('2026-07-01') },
      ]
    );
    // Neither counts, so it falls through to the installation date.
    expect(due!.toISOString().slice(0, 10)).toBe('2026-02-01');
  });

  it('clamps month-end overflow instead of rolling into the next month', () => {
    // 31 Jan + 1 month must be 28/29 Feb, never 2/3 March.
    expect(calculateNextMaintenanceDate(new Date('2026-01-31T00:00:00Z'), MONTHLY, 1).toISOString().slice(0, 10)).toBe('2026-02-28');
    // Leap year.
    expect(calculateNextMaintenanceDate(new Date('2024-01-31T00:00:00Z'), MONTHLY, 1).toISOString().slice(0, 10)).toBe('2024-02-29');
  });

  it('crosses a year boundary correctly', () => {
    expect(calculateNextMaintenanceDate(new Date('2026-11-15T00:00:00Z'), MONTHLY, 3).toISOString().slice(0, 10)).toBe('2027-02-15');
  });

  it('handles the half-month step', () => {
    expect(calculateNextMaintenanceDate(new Date('2026-01-10T00:00:00Z'), MONTHLY, 1.5).toISOString().slice(0, 10)).toBe('2026-02-25');
  });

  it('classifies overdue, due-soon and normal from one threshold', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    expect(getMaintenancePriority(new Date('2026-06-14T00:00:00Z'), now)).toBe('OVERDUE');
    expect(getMaintenancePriority(new Date('2026-06-15T00:00:00Z'), now)).toBe('DUE_SOON');
    expect(getMaintenancePriority(new Date(`2026-06-${15 + DUE_SOON_DAYS}T00:00:00Z`), now)).toBe('DUE_SOON');
    expect(getMaintenancePriority(new Date(`2026-06-${16 + DUE_SOON_DAYS}T00:00:00Z`), now)).toBe('NORMAL');
    expect(getMaintenancePriority(null, now)).toBe('UNKNOWN');
  });

  it('counts whole calendar days, so a clock time cannot flip due-today into overdue', () => {
    // Late in the day, UTC, against a date-only due date of the same day.
    const now = new Date('2026-06-15T23:30:00Z');
    expect(daysUntilDue(new Date('2026-06-15T00:00:00Z'), now)).toBe(0);
    expect(getMaintenancePriority(new Date('2026-06-15T00:00:00Z'), now)).toBe('DUE_SOON');
    // And the same holds for an Asia/Riyadh (UTC+3) wall-clock morning.
    const riyadhMorning = new Date('2026-06-15T05:00:00Z');
    expect(daysUntilDue(new Date('2026-06-15T00:00:00Z'), riyadhMorning)).toBe(0);
  });

  it('never reports a negative remaining-days figure for an overdue customer', () => {
    const now = new Date('2026-06-15T00:00:00Z');
    const d = describeMaintenanceDue(new Date('2026-06-05T00:00:00Z'), now);
    expect(d.maintenancePriority).toBe('OVERDUE');
    // The signed value stays available for sorting...
    expect(d.daysUntilMaintenance).toBe(-10);
    // ...but the UI renders this one, which is always a positive magnitude.
    expect(d.daysOverdue).toBe(10);
  });

  it('reports no day count at all when the due date is unknown', () => {
    const d = describeMaintenanceDue(null);
    expect(d).toEqual({ maintenancePriority: 'UNKNOWN', daysUntilMaintenance: null, daysOverdue: null });
  });
});

describe('Maintenance due engine — materialization', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string;
  const customerIds: string[] = [];

  async function createCustomer(overrides: Record<string, unknown> = {}) {
    const res = await request(ts.baseUrl)
      .post('/api/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Due Engine ${uniqueSuffix()}`,
        phone: testPhone(),
        maintenanceCycle: 'MONTHLY',
        maintenanceFrequency: 3,
        address: { city: 'Riyadh', district: 'D', street: 'S' },
        ...overrides,
      });
    if (res.body?.data?.id) customerIds.push(res.body.data.id);
    return res;
  }

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
  });

  afterAll(async () => {
    await prisma.appointment.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await stopTestServer(ts.server);
  });

  it('is populated on customer creation from the installation date', async () => {
    const res = await createCustomer({ installationDate: '2026-01-15', maintenanceFrequency: 3 });
    expect(res.status).toBe(201);
    const row = await prisma.customer.findUnique({ where: { id: res.body.data.id }, select: { nextMaintenanceDueAt: true } });
    expect(row!.nextMaintenanceDueAt!.toISOString().slice(0, 10)).toBe('2026-04-15');
  });

  it('stays NULL for a customer with no derivable baseline', async () => {
    const res = await createCustomer();
    const row = await prisma.customer.findUnique({ where: { id: res.body.data.id }, select: { nextMaintenanceDueAt: true } });
    expect(row!.nextMaintenanceDueAt).toBeNull();
  });

  it('is recalculated when the maintenance interval changes', async () => {
    const created = await createCustomer({ installationDate: '2026-01-15', maintenanceFrequency: 3 });
    const id = created.body.data.id;

    const updated = await request(ts.baseUrl)
      .put(`/api/customers/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ maintenanceFrequency: 6 });
    expect(updated.status).toBe(200);

    const row = await prisma.customer.findUnique({ where: { id }, select: { nextMaintenanceDueAt: true } });
    expect(row!.nextMaintenanceDueAt!.toISOString().slice(0, 10)).toBe('2026-07-15');
  });

  it('is recalculated when the installation date changes', async () => {
    const created = await createCustomer({ installationDate: '2026-01-15', maintenanceFrequency: 1 });
    const id = created.body.data.id;

    await request(ts.baseUrl)
      .put(`/api/customers/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ installationDate: '2026-03-15' });

    const row = await prisma.customer.findUnique({ where: { id }, select: { nextMaintenanceDueAt: true } });
    expect(row!.nextMaintenanceDueAt!.toISOString().slice(0, 10)).toBe('2026-04-15');
  });

  it('is NOT recalculated by an edit that cannot move the due date', async () => {
    const created = await createCustomer({ installationDate: '2026-01-15', maintenanceFrequency: 3 });
    const id = created.body.data.id;
    const beforeRow = await prisma.customer.findUnique({ where: { id }, select: { nextMaintenanceDueAt: true } });

    await request(ts.baseUrl)
      .put(`/api/customers/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ notes: 'just a note' });

    const afterRow = await prisma.customer.findUnique({ where: { id }, select: { nextMaintenanceDueAt: true } });
    expect(afterRow!.nextMaintenanceDueAt!.getTime()).toBe(beforeRow!.nextMaintenanceDueAt!.getTime());
  });

  it('moves forward when a maintenance is completed, overriding the installation baseline', async () => {
    const created = await createCustomer({ installationDate: '2026-01-15', maintenanceFrequency: 3 });
    const id = created.body.data.id;

    await prisma.appointment.create({
      data: {
        customerId: id, type: 'MAINTENANCE', scheduledDate: new Date('2026-05-01'),
        workStatus: 'COMPLETED', actualCompletionDate: new Date('2026-05-01'),
      },
    });
    await recalculateCustomerMaintenanceDue(prisma, id);

    const row = await prisma.customer.findUnique({ where: { id }, select: { nextMaintenanceDueAt: true } });
    expect(row!.nextMaintenanceDueAt!.toISOString().slice(0, 10)).toBe('2026-08-01');
  });

  it('recalculation is idempotent', async () => {
    const created = await createCustomer({ installationDate: '2026-02-20', maintenanceFrequency: 2 });
    const id = created.body.data.id;
    const first = await recalculateCustomerMaintenanceDue(prisma, id);
    const second = await recalculateCustomerMaintenanceDue(prisma, id);
    expect(second!.getTime()).toBe(first!.getTime());
  });

  it('does not bump the customer version, so it cannot invalidate an in-flight edit', async () => {
    const created = await createCustomer({ installationDate: '2026-01-15' });
    const id = created.body.data.id;
    const before = await prisma.customer.findUnique({ where: { id }, select: { version: true } });
    await recalculateCustomerMaintenanceDue(prisma, id);
    const after = await prisma.customer.findUnique({ where: { id }, select: { version: true } });
    expect(after!.version).toBe(before!.version);
  });

  it('exposes the priority classification on the customer list', async () => {
    const created = await createCustomer({ installationDate: '2020-01-15', maintenanceFrequency: 1 });
    const res = await request(ts.baseUrl)
      .get('/api/customers')
      .query({ includeSchedule: 'true', search: created.body.data.name, limit: 20 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const row = res.body.data.find((c: any) => c.id === created.body.data.id);
    expect(row.maintenancePriority).toBe('OVERDUE');
    // The rendered figure is never negative.
    expect(row.daysOverdue).toBeGreaterThan(0);
  });
});
