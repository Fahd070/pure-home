// Modification #11: the Dashboard "Call Report" shortcut is only a new UI
// entry point into the EXISTING Call Reports subsystem (POST/GET /call-reports,
// unchanged in this modification). These tests lock in the exact contract the
// shortcut relies on: Scheduling is already authorized to create via customerId
// (no role change was needed), a report created this way is indistinguishable
// from one created through the standalone page, and creating a call report
// never touches appointment/Modification #5/#8 state or financial privacy.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('Modification #11: Call Report Dashboard shortcut (existing subsystem contract)', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedToken: string, techToken: string;
  let customerId: string;
  const createdReportIds: string[] = [];
  const createdAppointmentIds: string[] = [];

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');
    techToken = signTestToken(users.technician.id, 'TECHNICIAN');

    const custRes = await request(ts.baseUrl)
      .post('/api/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Call Report Shortcut Customer',
        phone: testPhone(),
        maintenanceCycle: 'MONTHLY',
        maintenanceFrequency: 1,
        address: { city: 'Khobar', district: 'Test', street: 'Test' },
      });
    customerId = custRes.body.data.id;
  });

  afterAll(async () => {
    for (const id of createdReportIds) await prisma.$executeRawUnsafe(`DELETE FROM "call_reports" WHERE id = $1`, id);
    if (createdAppointmentIds.length) await prisma.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
    if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
    await stopTestServer(ts.server);
  });

  // 11. Scheduling is already authorized (no role broadening was required)
  it('Scheduling can create a call report by customerId -- the exact shape the Dashboard shortcut submits', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/call-reports')
      .set('Authorization', `Bearer ${schedToken}`)
      .send({ customerId, employeeName: 'Sched Employee', callDate: new Date().toISOString(), notes: 'Called about maintenance' });
    expect(res.status).toBe(201);
    expect(res.body.data.customerId).toBe(customerId);
    createdReportIds.push(res.body.data.id);
  });

  // 7 & 9. Exactly one report is created, and it appears in the standard list
  it('creates exactly one report, retrievable via the standard list and filtered by customerId', async () => {
    const before = await request(ts.baseUrl).get('/api/call-reports').set('Authorization', `Bearer ${schedToken}`).then(r => r.body.data.length);
    const res = await request(ts.baseUrl)
      .post('/api/call-reports')
      .set('Authorization', `Bearer ${schedToken}`)
      .send({ customerId, employeeName: 'Sched Employee', callDate: new Date().toISOString() });
    expect(res.status).toBe(201);
    createdReportIds.push(res.body.data.id);

    const after = await request(ts.baseUrl).get('/api/call-reports').set('Authorization', `Bearer ${schedToken}`).then(r => r.body.data.length);
    expect(after).toBe(before + 1);

    const filtered = await request(ts.baseUrl).get('/api/call-reports').set('Authorization', `Bearer ${schedToken}`).query({ customerId });
    expect(filtered.body.data.every((r: any) => r.customerId === customerId)).toBe(true);
    expect(filtered.body.data.some((r: any) => r.id === res.body.data.id)).toBe(true);
  });

  // 6. Existing required-field validation is enforced unchanged
  it('rejects a report with neither customerId nor unregisteredName (existing validation)', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/call-reports')
      .set('Authorization', `Bearer ${schedToken}`)
      .send({ employeeName: 'Sched Employee', callDate: new Date().toISOString() });
    expect(res.status).toBe(400);
  });

  it('rejects a report missing employeeName (existing validation)', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/call-reports')
      .set('Authorization', `Bearer ${schedToken}`)
      .send({ customerId, callDate: new Date().toISOString() });
    expect(res.status).toBe(400);
  });

  it('rejects a report with an invalid callDate (existing validation)', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/call-reports')
      .set('Authorization', `Bearer ${schedToken}`)
      .send({ customerId, employeeName: 'Sched Employee', callDate: 'not-a-date' });
    expect(res.status).toBe(400);
  });

  // 12 & 13. Technician is not authorized to use the shortcut/API
  it('Technician cannot create a call report (403)', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/call-reports')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ customerId, employeeName: 'x', callDate: new Date().toISOString() });
    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated create request', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/call-reports')
      .send({ customerId, employeeName: 'x', callDate: new Date().toISOString() });
    expect(res.status).toBe(401);
  });

  // 14. Audit behavior preserved -- identifies the actual creating user
  it('records an audit entry identifying the Scheduling user who created the report', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/call-reports')
      .set('Authorization', `Bearer ${schedToken}`)
      .send({ customerId, employeeName: 'Sched Employee', callDate: new Date().toISOString() });
    createdReportIds.push(res.body.data.id);
    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'call_report', entityId: res.body.data.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeTruthy();
    expect(audit?.userId).toBe(users.scheduling.id);
    // Established convention in this codebase: the AuditLog.action column
    // stores the human-readable label text (see writeAudit in
    // services/audit.service.ts), not the CREATE/UPDATE/DELETE enum.
    expect(audit?.action).toContain('Call report created');
    expect(audit?.action).toContain('Sched Employee');
  });

  // 16. Report attaches to the exact customer submitted, never another
  it('a report created for customer A is never attached to a different customer B', async () => {
    const custBRes = await request(ts.baseUrl)
      .post('/api/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Customer B', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: { city: 'Riyadh', district: 'Test', street: 'Test' } });
    const customerBId = custBRes.body.data.id;

    const res = await request(ts.baseUrl)
      .post('/api/call-reports')
      .set('Authorization', `Bearer ${schedToken}`)
      .send({ customerId, employeeName: 'Sched Employee', callDate: new Date().toISOString() });
    createdReportIds.push(res.body.data.id);

    expect(res.body.data.customerId).toBe(customerId);
    expect(res.body.data.customerId).not.toBe(customerBId);

    await prisma.customer.delete({ where: { id: customerBId } });
  });

  // 19, 20, 21. Creating a call report never mutates appointment/Mod5/Mod8 state
  it('creating a call report does not alter an existing appointment\'s workStatus, export/approval state, or maintenanceConfirmed', async () => {
    const apptRes = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${schedToken}`)
      .send({ customerId, type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 86400000).toISOString() });
    const apptId = apptRes.body.data.id;
    createdAppointmentIds.push(apptId);
    await request(ts.baseUrl).patch(`/api/appointments/${apptId}/export-to-technicians`).set('Authorization', `Bearer ${schedToken}`).send({});

    const before = await prisma.appointment.findUnique({ where: { id: apptId } });

    const reportRes = await request(ts.baseUrl)
      .post('/api/call-reports')
      .set('Authorization', `Bearer ${schedToken}`)
      .send({ customerId, employeeName: 'Sched Employee', callDate: new Date().toISOString(), notes: 'Follow-up call' });
    createdReportIds.push(reportRes.body.data.id);

    const after = await prisma.appointment.findUnique({ where: { id: apptId } });
    expect(after?.workStatus).toBe(before?.workStatus);
    expect(after?.visibleToTechnician).toBe(before?.visibleToTechnician);
    expect(after?.adminApproved).toBe(before?.adminApproved);
    expect(after?.maintenanceConfirmed).toBe(before?.maintenanceConfirmed);
    expect(after?.version).toBe(before?.version);
  });

  // 22. No financial/privacy regression
  it('the call report response never contains completion financial fields', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/call-reports')
      .set('Authorization', `Bearer ${schedToken}`)
      .send({ customerId, employeeName: 'Sched Employee', callDate: new Date().toISOString() });
    createdReportIds.push(res.body.data.id);
    expect(res.body.data.completionAmount).toBeUndefined();
    expect(res.body.data.completionPaymentMethod).toBeUndefined();
  });

  // 10. Standalone creation still works unchanged (Admin path, regression)
  it('Admin standalone creation still works unchanged (regression)', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/call-reports')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ unregisteredName: 'Regression Caller', employeeName: 'Admin Employee', callDate: new Date().toISOString() });
    expect(res.status).toBe(201);
    createdReportIds.push(res.body.data.id);
  });
});
