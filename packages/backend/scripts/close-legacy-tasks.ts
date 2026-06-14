import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const before = await prisma.maintenanceTask.count({
    where: { status: { notIn: ['COMPLETED'] } },
  });

  if (before === 0) {
    console.log('✓ No legacy tasks found — queue is already clean.');
    return;
  }

  const { count } = await prisma.maintenanceTask.updateMany({
    where: { status: { notIn: ['COMPLETED'] } },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      completionAmount: 0,
      serviceDetails: '.',
      completionPaymentMethod: 'CASH',
      notes: '.',
    },
  });

  const remaining = await prisma.maintenanceTask.count({
    where: { status: { notIn: ['COMPLETED'] } },
  });

  console.log(`✓ Closed ${count} legacy task(s).`);
  console.log(`✓ Remaining non-completed tasks: ${remaining}`);

  if (remaining > 0) {
    console.error('⚠ Warning: some tasks were not closed. Check for constraint violations.');
    process.exit(1);
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
