import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "maintenance_tasks" ADD COLUMN IF NOT EXISTS "completionImage" TEXT`
  );
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name='maintenance_tasks' AND column_name='completionImage'`
  );
  if (rows.length > 0) {
    console.log('✓ completionImage column is present in maintenance_tasks.');
  } else {
    console.error('✗ Column was NOT added. Check DB permissions.');
    process.exit(1);
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
