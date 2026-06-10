import cron from 'node-cron';
import prisma from '../prisma';
import { emitToRole } from '../socket';
import { SOCKET_EVENTS } from '../constants';

const REMINDER_DAYS = [10, 7, 3, 1];

async function generateReminders() {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 86400000);

    const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true } });
    if (!users.length) return;

    let created = 0;

    // Upcoming reminders: 10, 7, 3, 1 days ahead
    for (const days of REMINDER_DAYS) {
      const target = new Date(now);
      target.setDate(target.getDate() + days);
      const start = new Date(target.getFullYear(), target.getMonth(), target.getDate());
      const end = new Date(start.getTime() + 86400000);

      const appointments = await prisma.appointment.findMany({
        where: { scheduledDate: { gte: start, lt: end }, status: { not: 'CANCELLED' } },
        include: { customer: true }
      });

      for (const appt of appointments) {
        const key = `upcoming:${appt.id}:${days}`;
        const existing = await prisma.notification.findFirst({
          where: { type: 'APPOINTMENT_REMINDER', body: { contains: key }, createdAt: { gte: todayStart } }
        });
        if (existing) continue;

        const customerName = appt.customer?.name || 'زيارة عاجلة';
        const titleAr = days === 1
          ? `تذكير: صيانة "${customerName}" غداً`
          : `تذكير: صيانة "${customerName}" بعد ${days} أيام`;
        const bodyAr = `العميل ${customerName} لديه موعد صيانة بعد ${days === 1 ? 'يوم' : days + ' أيام'}. [${key}]`;

        await prisma.notification.createMany({
          data: users.map((u: { id: string }) => ({
            userId: u.id,
            title: titleAr,
            body: bodyAr,
            type: 'APPOINTMENT_REMINDER'
          }))
        });
        created++;
      }
    }

    // Due today
    const todayAppts = await prisma.appointment.findMany({
      where: { scheduledDate: { gte: todayStart, lt: todayEnd }, status: { not: 'CANCELLED' } },
      include: { customer: true }
    });
    for (const appt of todayAppts) {
      const key = `today:${appt.id}`;
      const existing = await prisma.notification.findFirst({
        where: { type: 'APPOINTMENT_REMINDER', body: { contains: key }, createdAt: { gte: todayStart } }
      });
      if (existing) continue;
      await prisma.notification.createMany({
        data: users.map((u: { id: string }) => ({
          userId: u.id,
          title: `الصيانة اليوم: "${appt.customer?.name || 'زيارة عاجلة'}"`,
          body: `موعد صيانة العميل ${appt.customer?.name || 'زيارة عاجلة'} اليوم. [${key}]`,
          type: 'APPOINTMENT_REMINDER'
        }))
      });
      created++;
    }

    // Overdue: past due, not cancelled, not completed, within last 30 days
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
    const overdueAppts = await prisma.appointment.findMany({
      where: {
        scheduledDate: { gte: thirtyDaysAgo, lt: todayStart },
        status: { not: 'CANCELLED' },
        NOT: { task: { status: 'COMPLETED' } }
      },
      include: { customer: true }
    });
    for (const appt of overdueAppts) {
      const key = `overdue:${appt.id}`;
      const existing = await prisma.notification.findFirst({
        where: { type: 'APPOINTMENT_REMINDER', body: { contains: key }, createdAt: { gte: todayStart } }
      });
      if (existing) continue;
      const daysLate = Math.floor((now.getTime() - new Date(appt.scheduledDate).getTime()) / 86400000);
      await prisma.notification.createMany({
        data: users.map((u: { id: string }) => ({
          userId: u.id,
          title: `⚠️ صيانة متأخرة: "${appt.customer?.name || 'زيارة عاجلة'}"`,
          body: `صيانة العميل ${appt.customer?.name || 'زيارة عاجلة'} متأخرة منذ ${daysLate === 1 ? 'يوم' : daysLate + ' أيام'}. [${key}]`,
          type: 'APPOINTMENT_REMINDER'
        }))
      });
      created++;
    }

    if (created > 0) {
      ['ADMIN', 'SCHEDULING', 'TECHNICIAN'].forEach(role =>
        emitToRole(role, SOCKET_EVENTS.NOTIFICATION_NEW, { type: 'APPOINTMENT_REMINDER', count: created })
      );
      console.log(`[cron] Created ${created} reminder notification(s)`);
    }
  } catch (e) {
    console.error('[cron] Reminder error:', e);
  }
}

export function startNotificationCron() {
  cron.schedule('0 * * * *', generateReminders); // Every hour
  setTimeout(generateReminders, 3000);           // Also run shortly after startup
}
