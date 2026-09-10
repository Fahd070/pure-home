// One-time (and safely repeatable) backfill of Customer.nextMaintenanceDueAt.
//
// WHY THIS IS A SCRIPT AND NOT SQL IN THE MIGRATION
// -------------------------------------------------
// The due-date rule is real business logic: a recurrence cycle applied to a
// baseline chosen from completed maintenance, else a recorded previous service,
// else the installation date -- with calendar-safe month addition and a
// half-month step. Expressing that a second time in the migration's SQL would
// create exactly the duplicate formula this phase exists to eliminate, and the
// two copies would drift the first time the rule changed. This script therefore
// calls the SAME service the running application calls, so there is only ever
// one implementation.
//
// SAFETY
// ------
// * Writes ONE derived column, on customers only. It never touches appointments,
//   users, financial fields, or any customer field a human entered.
// * Idempotent: the value is computed from the customer's own history, so
//   running it twice produces the same result. Safe to re-run at any time, and
//   safe to run again later if a recalculation is ever missed.
// * Never fabricates a date. A customer with no completed maintenance, no
//   recorded previous service and no installation date is left NULL, which is
//   the honest answer ("unknown") rather than a made-up due date that would put
//   them in an overdue list they do not belong in.
// * `--dry-run` reports exactly what would change and writes nothing.
//
// Usage (from packages/backend, DATABASE_URL pointed at the target database):
//   npx ts-node scripts/backfill-next-maintenance-due.ts --dry-run
//   npx ts-node scripts/backfill-next-maintenance-due.ts
import 'dotenv/config';
import prisma from '../src/prisma';
import { computeNextMaintenanceDate, MaintenanceCycleType } from '../src/services/maintenanceSchedule.service';

const DRY_RUN = process.argv.includes('--dry-run');
// Customers are processed in pages so a large table is never loaded at once.
const PAGE_SIZE = 200;

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.getTime() === b.getTime();
}

async function main() {
  console.log('');
  console.log(`  Backfill Customer.nextMaintenanceDueAt${DRY_RUN ? '  [DRY RUN — no writes]' : ''}`);
  console.log('  ------------------------------------------------------------');

  const total = await prisma.customer.count();
  console.log(`  Customers to process: ${total}`);

  let processed = 0, changed = 0, unchanged = 0, nullBaseline = 0;
  let cursor: string | undefined;

  for (;;) {
    const customers = await prisma.customer.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true, name: true,
        maintenanceCycle: true, maintenanceFrequency: true,
        previousServiceDate: true, installationDate: true, nextMaintenanceDueAt: true,
      },
    });
    if (customers.length === 0) break;
    cursor = customers[customers.length - 1].id;

    for (const c of customers) {
      const appointments = await prisma.appointment.findMany({
        where: { customerId: c.id },
        select: { isUrgent: true, workStatus: true, actualCompletionDate: true, completedAt: true, scheduledDate: true },
      });

      const dueAt = computeNextMaintenanceDate(
        {
          maintenanceCycle: c.maintenanceCycle as MaintenanceCycleType,
          maintenanceFrequency: c.maintenanceFrequency,
          previousServiceDate: c.previousServiceDate,
          installationDate: c.installationDate,
        },
        appointments
      );

      if (dueAt === null) nullBaseline++;

      if (sameInstant(dueAt, c.nextMaintenanceDueAt)) {
        unchanged++;
      } else {
        changed++;
        if (!DRY_RUN) {
          // Does NOT bump `version`: this is a system-maintained derived field,
          // not a user edit, and must never invalidate someone's in-flight
          // optimistic-concurrency token.
          await prisma.customer.update({ where: { id: c.id }, data: { nextMaintenanceDueAt: dueAt } });
        }
      }
      processed++;
    }

    console.log(`  ...processed ${processed}/${total}`);
  }

  console.log('');
  console.log(`  Processed:            ${processed}`);
  console.log(`  ${DRY_RUN ? 'Would change:       ' : 'Updated:            '}  ${changed}`);
  console.log(`  Already correct:      ${unchanged}`);
  console.log(`  Left NULL (no baseline available, deliberately not invented): ${nullBaseline}`);
  console.log('');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('  Backfill FAILED:', e?.message || e);
    await prisma.$disconnect();
    process.exit(1);
  });
