import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// Fields returned for one appointment inside the roster's legacy preview lists.
// Unchanged, including completionImage, because Desktop v3.6.5 reads exactly this
// shape from GET /technicians and renders the photo from it.
const TASK_FIELDS = {
  id: true, workStatus: true, status: true, completedAt: true,
  workNotes: true, serviceDetails: true,
  completionAmount: true, completionPaymentMethod: true,
  completionImage: true, nextMaintenanceNote: true,
  actualCompletionDate: true, maintenanceConfirmed: true,
  completionTechnicianName: true,
  type: true, scheduledDate: true,
  customer: { select: { id: true, name: true, phone: true } },
} as const;

// The same fields MINUS the base64 photograph, for the paginated activity list.
//
// completionImage is a full data URI. Sending twenty of them so a list can render
// customer name, date and type would reintroduce, one modal at a time, exactly
// the payload problem this route exists to avoid. The detail view fetches the
// single appointment it is about (GET /api/appointments/:id) and gets the photo
// then -- which is also the only moment anybody looks at it.
const { completionImage, ...ACTIVITY_TASK_FIELDS } = TASK_FIELDS;

/**
 * Turns a Prisma groupBy result into a plain id -> count lookup.
 *
 * Counting this way is the point of v4 Requirement #11's performance note: the
 * previous implementation loaded the 40 most recent appointments per technician
 * and counted the array, so a technician with 300 completions displayed some
 * number no larger than 40. The number was not merely truncated, it was wrong in
 * a way nothing on screen admitted to.
 */
function countsById(rows: Array<{ _count: number } & Record<string, any>>, key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const id = row[key];
    if (id) out[id] = row._count;
  }
  return out;
}

router.get('/', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const isAdmin = req.user!.role === 'ADMIN';
    const techs = await prisma.user.findMany({
      where: { role: 'TECHNICIAN' },
      select: {
        id: true, name: true, email: true, role: true,
        _count: { select: { assignedAppointments: true } },
        assignedAppointments: {
          where: { workStatus: { in: ['COMPLETED', 'POSTPONED'] } },
          select: { ...TASK_FIELDS, postponements: { orderBy: { createdAt: 'desc' as const }, take: 1 } },
          orderBy: { createdAt: 'desc' as const },
          take: 40,
        },
      },
    });

    const techIds = techs.map((t) => t.id);

    // Three grouped aggregations for the whole page, not three per technician.
    // Each is scoped by `in: techIds`, so the work is bounded by the roster
    // rather than by how much history the business has accumulated.
    const [completedRows, postponedRows, noAnswerRows] = techIds.length
      ? await Promise.all([
          // Completed work is attributed by the appointment's technician relation
          // -- the same relation that governs permissions and audit identity.
          prisma.appointment.groupBy({
            by: ['technicianId'],
            where: { technicianId: { in: techIds }, workStatus: 'COMPLETED' },
            _count: true,
          }),
          // Postponement history comes from the durable records, NOT from
          // appointments currently sitting in POSTPONED. Since v4 decision D2 a
          // postponement with an agreed new date moves the appointment back to
          // WAITING/RESCHEDULED, so counting current state would quietly erase
          // every postponement that was subsequently rescheduled -- which is most
          // of them, and exactly the ones worth reviewing.
          prisma.postponementRecord.groupBy({
            by: ['requestedById'],
            where: { requestedById: { in: techIds } },
            _count: true,
          }),
          // One row per contact attempt, so repeated attempts on the same
          // appointment each count -- that is what makes the number operational
          // rather than a restatement of "this appointment is stuck".
          prisma.customerNoAnswerRecord.groupBy({
            by: ['recordedById'],
            where: { recordedById: { in: techIds } },
            _count: true,
          }),
        ])
      : [[], [], []];

    const completedBy = countsById(completedRows as any[], 'technicianId');
    const postponedBy = countsById(postponedRows as any[], 'requestedById');
    const noAnswerBy = countsById(noAnswerRows as any[], 'recordedById');

    const result = techs.map((t: any) => {
      const completedTasksList = t.assignedAppointments.filter((x: any) => x.workStatus === 'COMPLETED').slice(0, 20);
      const postponedTasksList = t.assignedAppointments.filter((x: any) => x.workStatus === 'POSTPONED').slice(0, 20);
      const { assignedAppointments, ...rest } = t;
      return {
        ...rest,
        // Exact totals. completedTasksList/postponedTasksList remain the capped,
        // already-loaded preview lists Desktop v3.6.5 reads; the Phase 3 page
        // pages through /technicians/:id/activity instead.
        completedTasks: completedBy[t.id] || 0,
        postponedTasks: postponedBy[t.id] || 0,
        noAnswerCount: noAnswerBy[t.id] || 0,
        completedTasksList,
        postponedTasksList,
      };
    });
    if (!isAdmin) {
      result.forEach((tech: any) => {
        tech.completedTasksList?.forEach((appt: any) => {
          delete appt.completionImage;
          delete appt.completionAmount;
          delete appt.completionPaymentMethod;
        });
        tech.postponedTasksList?.forEach((appt: any) => { delete appt.completionImage; });
      });
    }
    res.json({ success: true, data: result });
  } catch (e) { next(e); }
});

const ACTIVITY_KINDS = ['completed', 'postponed', 'no-answer'] as const;
type ActivityKind = typeof ACTIVITY_KINDS[number];

/**
 * v4 Requirement #11: the durable activity behind one technician's counters.
 *
 * Deliberately a separate, paginated route rather than more data on the list
 * above: the list is rendered for every technician at once and a completion
 * carries a base64 image, so loading details eagerly for everyone in order to
 * show three numbers is the payload mistake the perf note warns about. One
 * technician's details are fetched only when an administrator opens them.
 *
 * Each kind reads the source of truth for its own metric, which is why they are
 * three queries and not three filters over one:
 *   completed  -> appointments attributed to this technician
 *   postponed  -> PostponementRecord (history, survives the later reschedule)
 *   no-answer  -> CustomerNoAnswerRecord (one row per attempt)
 */
router.get('/:id/activity', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const kind = String(req.query.kind || '') as ActivityKind;
    if (!ACTIVITY_KINDS.includes(kind)) {
      return res.status(400).json({ success: false, message: `kind must be one of: ${ACTIVITY_KINDS.join(', ')}` });
    }
    const page = Math.max(parseInt(String(req.query.page ?? '1')) || 1, 1);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20')) || 20, 1), 100);
    const skip = (page - 1) * limit;

    // Scoped to TECHNICIAN so this cannot be pointed at an Admin/Scheduling
    // account's id to enumerate their appointments.
    const tech = await prisma.user.findFirst({
      where: { id: req.params.id, role: 'TECHNICIAN' },
      select: { id: true, name: true, email: true },
    });
    if (!tech) return res.status(404).json({ success: false, message: 'Not found' });

    let total: number;
    let data: any[];

    if (kind === 'completed') {
      const where = { technicianId: tech.id, workStatus: 'COMPLETED' };
      [total, data] = await Promise.all([
        prisma.appointment.count({ where }),
        prisma.appointment.findMany({
          where,
          select: ACTIVITY_TASK_FIELDS,
          // actualCompletionDate is the technician-declared date the work really
          // happened; completedAt is when the submission arrived. Newest first by
          // the real date where it exists, with id as the total-order tiebreak so
          // paging cannot drop or repeat a row.
          orderBy: [{ actualCompletionDate: { sort: 'desc', nulls: 'last' } }, { completedAt: 'desc' }, { id: 'asc' }],
          skip, take: limit,
        }),
      ]);
    } else if (kind === 'postponed') {
      const where = { requestedById: tech.id };
      [total, data] = await Promise.all([
        prisma.postponementRecord.count({ where }),
        prisma.postponementRecord.findMany({
          where,
          select: {
            id: true, reason: true, previousDate: true, newDate: true, createdAt: true,
            appointment: {
              select: {
                id: true, type: true, status: true, workStatus: true, scheduledDate: true,
                customer: { select: { id: true, name: true, phone: true } },
              },
            },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip, take: limit,
        }),
      ]);
    } else {
      const where = { recordedById: tech.id };
      [total, data] = await Promise.all([
        prisma.customerNoAnswerRecord.count({ where }),
        prisma.customerNoAnswerRecord.findMany({
          where,
          // Deliberately narrow: the customer's name and phone and the
          // appointment this attempt belongs to. No credentials, no hashes, no
          // financial fields -- none of which this page asks a question about.
          select: {
            id: true, note: true, createdAt: true,
            appointment: {
              select: {
                id: true, type: true, scheduledDate: true,
                customer: { select: { id: true, name: true, phone: true } },
              },
            },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip, take: limit,
        }),
      ]);
    }

    res.json({
      success: true,
      data,
      meta: {
        total, page, limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        technician: tech,
      },
    });
  } catch (e) { next(e); }
});

router.get('/users', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true } });
    res.json({ success: true, data: users });
  } catch (e) { next(e); }
});

export default router;
