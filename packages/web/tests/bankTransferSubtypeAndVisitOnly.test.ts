// Final payment/visit/maintenance-note batch:
// (B) "Visit Only" (urgent-visits flow, technician/pages/UrgentAppointments.tsx):
//     amount auto-becomes 0, payment method/subtype are cleared and not required.
// (C) "Bank Transfer" subtype in the urgent-visits form: a required secondary
//     Transfer Type choice (Commercial/Personal) appears only for Bank Transfer.
// (D) Same Bank Transfer subtype behavior in the normal Technician completion
//     flow (technician/pages/TaskDetail.tsx).
// Follows this project's established pattern (see technicianNameCompletion.test.ts,
// maintenanceConfirmation.test.ts): source-level assertions against the exact
// production wiring, not a re-implementation or a jsdom render.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import i18n from '../../unified-app/src/i18n';

const taskDetailSrc = fs.readFileSync(
  path.resolve(__dirname, '../../unified-app/src/technician/pages/TaskDetail.tsx'), 'utf-8');
const urgentSrc = fs.readFileSync(
  path.resolve(__dirname, '../../unified-app/src/technician/pages/UrgentAppointments.tsx'), 'utf-8');
const adminUrgentSrc = fs.readFileSync(
  path.resolve(__dirname, '../../unified-app/src/admin/pages/UrgentAppointments.tsx'), 'utf-8');
const adminTechniciansSrc = fs.readFileSync(
  path.resolve(__dirname, '../../unified-app/src/admin/pages/Technicians.tsx'), 'utf-8');
const backendUrgentVisitsSrc = fs.readFileSync(
  path.resolve(__dirname, '../../backend/src/routes/urgent-visits.ts'), 'utf-8');
const backendAppointmentsSrc = fs.readFileSync(
  path.resolve(__dirname, '../../backend/src/routes/appointments.ts'), 'utf-8');

describe('i18n: Transfer Type / Visit Only exact required wording', () => {
  it('urgentAppts.transferType, commercialTransfer, personalTransfer', () => {
    expect(i18n.getFixedT('ar')('urgentAppts.transferType')).toBe('نوع التحويل');
    expect(i18n.getFixedT('en')('urgentAppts.transferType')).toBe('Transfer Type');
    expect(i18n.getFixedT('ar')('urgentAppts.commercialTransfer')).toBe('تحويل تجاري');
    expect(i18n.getFixedT('en')('urgentAppts.commercialTransfer')).toBe('Commercial Transfer');
    expect(i18n.getFixedT('ar')('urgentAppts.personalTransfer')).toBe('تحويل خاص');
    expect(i18n.getFixedT('en')('urgentAppts.personalTransfer')).toBe('Personal Transfer');
  });
  it('tasks.transferType, commercialTransfer, personalTransfer (normal completion flow)', () => {
    expect(i18n.getFixedT('ar')('tasks.transferType')).toBe('نوع التحويل');
    expect(i18n.getFixedT('en')('tasks.transferType')).toBe('Transfer Type');
    expect(i18n.getFixedT('ar')('tasks.commercialTransfer')).toBe('تحويل تجاري');
    expect(i18n.getFixedT('en')('tasks.commercialTransfer')).toBe('Commercial Transfer');
    expect(i18n.getFixedT('ar')('tasks.personalTransfer')).toBe('تحويل خاص');
    expect(i18n.getFixedT('en')('tasks.personalTransfer')).toBe('Personal Transfer');
  });
  it('the Next Maintenance Note label was already correct before this batch (Part A: no change needed)', () => {
    expect(i18n.getFixedT('ar')('tasks.nextMaintenanceNote')).toBe('ملاحظة الصيانة القادمة');
    expect(i18n.getFixedT('en')('tasks.nextMaintenanceNote')).toBe('Next Maintenance Note');
  });
});

describe('Part B: Visit Only (urgent-visits form)', () => {
  it('selecting Visit Only clears amount to "0" and clears paymentGroup/transferType', () => {
    expect(urgentSrc).toMatch(/if \(st === "VISIT_ONLY"\) \{[\s\S]*?amount: "0", paymentGroup: "", transferType: ""/);
  });
  it('leaving Visit Only for another service type resets amount/payment fresh (no stale values)', () => {
    expect(urgentSrc).toMatch(/if \(r\.serviceType === "VISIT_ONLY"\) \{[\s\S]*?amount: "", paymentGroup: "", transferType: ""/);
  });
  it('the payment method and transfer type sections are both hidden when Visit Only is selected', () => {
    expect(urgentSrc).toMatch(/\{!isVisitOnly && \(\s*<div>\s*<label[^>]*>\{t\("urgentAppts\.paymentMethod"\)/);
    expect(urgentSrc).toMatch(/\{!isVisitOnly && record\.paymentGroup === "BANK_TRANSFER" && \(/);
  });
  it('the amount input is disabled while Visit Only is selected', () => {
    expect(urgentSrc).toMatch(/disabled=\{isVisitOnly\}/);
  });
  it('paymentValid/amountValid are bypassed entirely for Visit Only (never required)', () => {
    expect(urgentSrc).toMatch(/const paymentValid = isVisitOnly \|\| resolvePaymentMethod\(\) !== null;/);
    expect(urgentSrc).toMatch(/const amountValid = isVisitOnly \|\|/);
  });
  it('the submitted amount is forced to 0 for Visit Only regardless of form state', () => {
    expect(urgentSrc).toMatch(/amount: isVisitOnly \? 0 : parseFloat\(record\.amount\),/);
  });
  it('paymentMethod is omitted from the submitted payload entirely for Visit Only', () => {
    expect(urgentSrc).toMatch(/\.\.\.\(paymentMethod \? \{ paymentMethod \} : \{\}\),/);
  });
});

describe('Part C: Bank Transfer subtype (urgent-visits form)', () => {
  it('resolvePaymentMethod() maps paymentGroup+transferType to the two required backend subtypes', () => {
    expect(urgentSrc).toMatch(/if \(record\.paymentGroup === "BANK_TRANSFER" && record\.transferType === "COMMERCIAL"\) return "BANK_TRANSFER_COMMERCIAL";/);
    expect(urgentSrc).toMatch(/if \(record\.paymentGroup === "BANK_TRANSFER" && record\.transferType === "PERSONAL"\) return "BANK_TRANSFER_PERSONAL";/);
  });
  it('selecting a payment group always clears transferType (must be re-chosen every time)', () => {
    expect(urgentSrc).toMatch(/function selectPaymentGroup\(pg: PaymentGroup\) \{[\s\S]*?setRecord\(r => \(\{ \.\.\.r, paymentGroup: pg, transferType: "" \}\)\);/);
  });
  it('the Transfer Type section only renders when paymentGroup is Bank Transfer', () => {
    expect(urgentSrc).toMatch(/\{!isVisitOnly && record\.paymentGroup === "BANK_TRANSFER" && \(/);
    expect(urgentSrc).toMatch(/\(\["COMMERCIAL","PERSONAL"\] as Array<"COMMERCIAL" \| "PERSONAL">\)\.map\(tt =>/);
  });
  it('Cash never requires a transfer subtype in resolvePaymentMethod()', () => {
    expect(urgentSrc).toMatch(/if \(record\.paymentGroup === "CASH"\) return "CASH";/);
  });
});

describe('Part D: Bank Transfer subtype in the normal Technician completion flow (TaskDetail.tsx)', () => {
  it('completionPaymentMethod is resolved via resolvePaymentMethod(), not a raw form field', () => {
    expect(taskDetailSrc).toMatch(/completionPaymentMethod:\s*resolvePaymentMethod\(\),/);
  });
  it('resolvePaymentMethod() maps paymentGroup+transferType to the two required backend subtypes', () => {
    expect(taskDetailSrc).toMatch(/if \(completeForm\.paymentGroup === "CASH"\) return "CASH";/);
    expect(taskDetailSrc).toMatch(/if \(completeForm\.transferType === "COMMERCIAL"\) return "BANK_TRANSFER_COMMERCIAL";/);
    expect(taskDetailSrc).toMatch(/if \(completeForm\.transferType === "PERSONAL"\) return "BANK_TRANSFER_PERSONAL";/);
  });
  it('paymentMethodValid requires a transferType only when paymentGroup is Bank Transfer', () => {
    expect(taskDetailSrc).toMatch(/const paymentMethodValid = completeForm\.paymentGroup === "CASH" \|\| !!completeForm\.transferType;/);
  });
  it('selecting a payment group always clears transferType (must be re-chosen every time)', () => {
    expect(taskDetailSrc).toMatch(/onClick=\{\(\) => setCompleteForm\(f => \(\{ \.\.\.f, paymentGroup: pg, transferType: "" \}\)\)\}/);
  });
  it('the Transfer Type section only renders when paymentGroup is Bank Transfer', () => {
    expect(taskDetailSrc).toMatch(/\{completeForm\.paymentGroup === "BANK_TRANSFER" && \(/);
  });
  it('the completion form is fully reset (including paymentGroup/transferType) between appointments', () => {
    expect(taskDetailSrc).toMatch(/const EMPTY_COMPLETE = \{[\s\S]*?paymentGroup: "CASH" as PaymentGroup, transferType: "" as TransferType,/);
  });
});

describe('Admin display sites show the new Bank Transfer subtypes (no stale bare "BANK_TRANSFER")', () => {
  it('admin/pages/UrgentAppointments.tsx: PAYMENT_LABELS covers both subtypes', () => {
    expect(adminUrgentSrc).toMatch(/BANK_TRANSFER_COMMERCIAL:/);
    expect(adminUrgentSrc).toMatch(/BANK_TRANSFER_PERSONAL:/);
    expect(adminUrgentSrc).not.toMatch(/BANK_TRANSFER:\s*isAr/);
  });
  it('admin/pages/UrgentAppointments.tsx: the payment-method badge no longer branches on the old bare "BANK_TRANSFER" value', () => {
    expect(adminUrgentSrc).not.toMatch(/v\.paymentMethod === "BANK_TRANSFER"/);
  });
  it('admin/pages/Technicians.tsx: PAYMENT_LABELS covers both subtypes', () => {
    expect(adminTechniciansSrc).toMatch(/BANK_TRANSFER_COMMERCIAL:/);
    expect(adminTechniciansSrc).toMatch(/BANK_TRANSFER_PERSONAL:/);
  });
});

describe('Backend: the bare "BANK_TRANSFER" value is no longer accepted anywhere', () => {
  it('urgent-visits.ts only accepts the two required subtypes', () => {
    expect(backendUrgentVisitsSrc).toMatch(/paymentMethod:\s*z\.enum\(\['CASH','BANK_TRANSFER_COMMERCIAL','BANK_TRANSFER_PERSONAL'\]\)\.optional\(\)/);
  });
  it('appointments.ts /complete only accepts the two required subtypes', () => {
    expect(backendAppointmentsSrc).toMatch(/completionPaymentMethod:\s*z\.enum\(\['CASH','BANK_TRANSFER_COMMERCIAL','BANK_TRANSFER_PERSONAL'\]\)\.optional\(\)/);
  });
});
