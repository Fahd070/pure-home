import 'dotenv/config';
import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
const prisma = new PrismaClient();
async function main() {
  const hash = (p: string) => bcrypt.hash(p, 12);
  const adminPwd  = process.env.SEED_ADMIN_PASSWORD       || (() => { throw new Error('SEED_ADMIN_PASSWORD not set in .env') })();
  const schedPwd  = process.env.SEED_SCHEDULING_PASSWORD  || (() => { throw new Error('SEED_SCHEDULING_PASSWORD not set in .env') })();
  const techPwd   = process.env.SEED_TECHNICIAN_PASSWORD  || (() => { throw new Error('SEED_TECHNICIAN_PASSWORD not set in .env') })();
  await prisma.user.upsert({ where: { email: 'admin@wfm.local' }, update: {}, create: { name: 'مدير النظام', email: 'admin@wfm.local', password: await hash(adminPwd), role: UserRole.ADMIN } });
  await prisma.user.upsert({ where: { email: 'scheduling@wfm.local' }, update: {}, create: { name: 'موظف الجدولة', email: 'scheduling@wfm.local', password: await hash(schedPwd), role: UserRole.SCHEDULING } });
  await prisma.user.upsert({ where: { email: 'tech1@wfm.local' }, update: {}, create: { name: 'فني 1', email: 'tech1@wfm.local', password: await hash(techPwd), role: UserRole.TECHNICIAN } });
  console.log('Seed done: 3 users created (admin, scheduling, technician)');
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
