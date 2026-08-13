import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import { getDashboardCategoryWheres } from '../src/services/dashboardCategorization.service';
import prisma from '../src/prisma';

const endpoints = ['completed-maintenance', 'postponed', 'overdue', 'today', 'this-month', 'next-month'] as const;

describe('Central dashboard categorization', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string;
  let schedulingToken: string;
  const customerIds: string[] = [];
  const appointmentIds: string[] = [];
  const prefix = `Dashboard Category ${Date.now()}`;

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedulingToken = signTestToken(users.scheduling.id, 'SCHEDULING');
  });

  afterAll(async () => {
    if (appointmentIds.length) await prisma.appointment.deleteMany({ where: { id: { in: appointmentIds } } });
    if (customerIds.length) await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await stopTestServer(ts.server);
  });

  async function createCustomer(suffix: string) {
    const response = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`).send({
      name: `${prefix} ${suffix}`, phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1,
      address: { city: 'Riyadh', district: 'Test', street: 'Category test' },
    });
    expect(response.status).toBe(201);
    customerIds.push(response.body.data.id);
    return response.body.data.id as string;
  }

  async function createAppointment(suffix: string, scheduledDate: Date, workStatus: string, extra: Record<string, unknown> = {}) {
    const customerId = await createCustomer(suffix);
    const appointment = await prisma.appointment.create({
      data: { customerId, type: 'MAINTENANCE', scheduledDate, workStatus, status: 'SCHEDULED', ...extra },
    });
    appointmentIds.push(appointment.id);
    return appointment.id;
  }

  async function idsFor(endpoint: string, token = adminToken) {
    const response = await request(ts.baseUrl).get(`/api/dashboard/${endpoint}`).query({ search: prefix, limit: 100 }).set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.meta.total).toBe(response.body.data.length);
    return response.body.data.map((item: any) => item.id) as string[];
  }

  it('encodes the documented precedence and non-overlapping calendar boundaries in one helper', () => {
    const now = new Date(2026, 5, 15, 12);
    const categories = getDashboardCategoryWheres(now);
    expect(categories.completed.workStatus).toBe('COMPLETED');
    expect(categories.postponed.workStatus).toBe('POSTPONED');
    for (const category of ['overdue', 'today', 'thisMonth', 'nextMonth'] as const) {
      expect(categories[category].workStatus).toEqual({ in: ['WAITING', 'IN_PROGRESS'] });
      expect(categories[category].status).toEqual({ in: ['SCHEDULED', 'RESCHEDULED', 'PENDING'] });
    }
    expect((categories.overdue.scheduledDate as any).lt).toEqual(new Date(2026, 5, 15));
    expect((categories.today.scheduledDate as any).gte).toEqual(new Date(2026, 5, 15));
    expect((categories.today.scheduledDate as any).lt).toEqual(new Date(2026, 5, 16));
    expect((categories.thisMonth.scheduledDate as any).gte).toEqual(new Date(2026, 5, 16));
    expect((categories.thisMonth.scheduledDate as any).lt).toEqual(new Date(2026, 6, 1));
    expect((categories.nextMonth.scheduledDate as any).gte).toEqual(new Date(2026, 6, 1));
    expect((categories.nextMonth.scheduledDate as any).lt).toEqual(new Date(2026, 7, 1));
  });

  it('places each maintenance record in exactly one compatible operational category for both roles', async () => {
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const completed = await createAppointment('Completed', new Date(startToday.getTime() + 12 * 3600000), 'COMPLETED', { completionAmount: 250, completedAt: now });
    const postponed = await createAppointment('Postponed', new Date(now.getFullYear(), now.getMonth() + 1, 10, 12), 'POSTPONED');
    const overdue = await createAppointment('Overdue', new Date(startToday.getTime() - 12 * 3600000), 'WAITING');
    const today = await createAppointment('Today', new Date(startToday.getTime() + 12 * 3600000), 'WAITING');
    const futureThisMonthDate = new Date(startToday.getTime() + 36 * 3600000);
    const thisMonth = futureThisMonthDate.getMonth() === now.getMonth()
      ? await createAppointment('This Month', futureThisMonthDate, 'WAITING')
      : null;
    const nextMonth = await createAppointment('Next Month', new Date(now.getFullYear(), now.getMonth() + 1, 12, 12), 'WAITING');

    const expected: Record<string, string[]> = {
      'completed-maintenance': [completed], postponed: [postponed], overdue: [overdue], today: [today], 'next-month': [nextMonth],
    };
    if (thisMonth) expected['this-month'] = [thisMonth];
    const seen = new Map<string, string[]>();
    for (const endpoint of endpoints) {
      const adminIds = await idsFor(endpoint);
      const schedulingIds = await idsFor(endpoint, schedulingToken);
      expect(schedulingIds).toEqual(adminIds);
      for (const id of adminIds) seen.set(id, [...(seen.get(id) || []), endpoint]);
      if (expected[endpoint]) expect(adminIds).toEqual(expected[endpoint]);
    }
    for (const id of [completed, postponed, overdue, today, thisMonth, nextMonth].filter(Boolean) as string[]) expect(seen.get(id)).toHaveLength(1);

    const schedulingCompleted = await request(ts.baseUrl).get('/api/dashboard/completed-maintenance').query({ search: `${prefix} Completed` }).set('Authorization', `Bearer ${schedulingToken}`);
    expect(schedulingCompleted.body.data[0]).not.toHaveProperty('completionAmount');
  });

  it('keeps every displayed stats count synchronized with its opened list total', async () => {
    const statsKeys: Record<string, string> = {
      'completed-maintenance': 'completed', postponed: 'pending', overdue: 'pendingApproval', today: 'todayCount', 'this-month': 'thisMonth', 'next-month': 'nextMonth',
    };
    for (const token of [adminToken, schedulingToken]) {
      const stats = await request(ts.baseUrl).get('/api/dashboard/stats').set('Authorization', `Bearer ${token}`);
      for (const endpoint of endpoints) {
        const list = await request(ts.baseUrl).get(`/api/dashboard/${endpoint}`).query({ limit: 100 }).set('Authorization', `Bearer ${token}`);
        expect(stats.body.data[statsKeys[endpoint]]).toBe(list.body.meta.total);
        if (list.body.meta.total <= 100) expect(list.body.data).toHaveLength(list.body.meta.total);
      }
    }
  });
});
