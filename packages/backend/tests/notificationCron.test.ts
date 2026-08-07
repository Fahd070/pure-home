// Regression test for the reliability sweep's reminder-cron overlap guard
// (packages/backend/src/services/notification.service.ts). Without the guard,
// two concurrent runs of generateReminders() could both pass the same
// non-transactional "does this reminder already exist" check before either had
// written its row, producing duplicate notifications for the same appointment/day.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateReminders } from '../src/services/notification.service';
import { ensureTestUsers, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('notification cron overlap guard', () => {
  let users: TestUsers;
  let customerId: string;
  let appointmentId: string;

  beforeAll(async () => {
    users = await ensureTestUsers();
    const customer = await prisma.customer.create({
      data: {
        name: 'Cron Overlap Test Customer',
        phone: testPhone(),
        maintenanceCycle: 'MONTHLY',
        maintenanceFrequency: 1,
        address: { create: { city: 'Riyadh', district: 'Test', street: 'Test' } },
      },
    });
    customerId = customer.id;
    // "Due today" branch is the simplest to trigger deterministically.
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
    const appt = await prisma.appointment.create({
      data: {
        customerId,
        type: 'MAINTENANCE',
        scheduledDate: todayStart,
        status: 'SCHEDULED',
      },
    });
    appointmentId = appt.id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { body: { contains: `today:${appointmentId}` } } });
    await prisma.appointment.deleteMany({ where: { id: appointmentId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
  });

  it('two concurrent invocations do not create duplicate reminder notifications for the same appointment', async () => {
    const before = await prisma.notification.count({ where: { body: { contains: `today:${appointmentId}` } } });
    expect(before).toBe(0);

    // Fired without awaiting the first -- the guard's check-and-set is synchronous
    // (runs before the function's first await), so this reliably exercises the
    // exact overlap the fix prevents, regardless of how fast the DB responds.
    await Promise.all([generateReminders(), generateReminders()]);

    const created = await prisma.notification.findMany({
      where: { body: { contains: `today:${appointmentId}` }, userId: users.admin.id },
    });
    expect(created).toHaveLength(1);
  });
});
