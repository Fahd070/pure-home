// Source-level regression tests for Modification #8: the required Completion
// Date field in the Technician completion modal, and the Scheduling/Maintenance
// confirm-operation review workflow. Follows this project's established pattern
// for full-page components that call useQuery/useMutation/useTranslation
// directly (see appointmentExport.test.ts, nextMaintenanceNote.test.ts) --
// source-level assertions instead of rebuilding each department's full
// router/api-client/provider stack for no additional signal.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import i18n from '../../unified-app/src/i18n';

const taskDetailSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/technician/pages/TaskDetail.tsx'), 'utf-8');
const schedApptDetailSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/scheduling/pages/AppointmentDetail.tsx'), 'utf-8');
const schedApptsSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/scheduling/pages/Appointments.tsx'), 'utf-8');
const schedCustomerListSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/scheduling/pages/CustomerList.tsx'), 'utf-8');

describe('i18n: exact required labels', () => {
  it('tasks.completionDate matches the required Arabic/English wording', () => {
    expect(i18n.t('tasks.completionDate')).toBe('تاريخ الإكمال');
  });
  it('appointments.confirmOperation matches the required Arabic/English wording', () => {
    expect(i18n.getFixedT('ar')('appointments.confirmOperation')).toBe('تأكيد العملية');
    expect(i18n.getFixedT('en')('appointments.confirmOperation')).toBe('Confirm Operation');
  });
  it('appointments.awaitingMaintenanceConfirmation / operationConfirmed match the required wording', () => {
    expect(i18n.getFixedT('ar')('appointments.awaitingMaintenanceConfirmation')).toBe('بانتظار تأكيد الصيانة');
    expect(i18n.getFixedT('en')('appointments.awaitingMaintenanceConfirmation')).toBe('Awaiting Maintenance Confirmation');
    expect(i18n.getFixedT('ar')('appointments.operationConfirmed')).toBe('تم تأكيد العملية');
    expect(i18n.getFixedT('en')('appointments.operationConfirmed')).toBe('Operation Confirmed');
  });
});

describe('Technician completion modal: required Completion Date field', () => {
  it('adds actualCompletionDate to the completion form state, defaulting to empty', () => {
    expect(taskDetailSrc).toMatch(/actualCompletionDate:\s*""/);
  });

  it('renders a required native date input for the Completion Date, capped at today', () => {
    expect(taskDetailSrc).toMatch(/t\("tasks\.completionDate"\)/);
    expect(taskDetailSrc).toMatch(/type="date"\s+required\s+value=\{completeForm\.actualCompletionDate\}\s+max=\{todayDateInputValue\(\)\}/);
  });

  it('a future date cannot be picked client-side (max is capped to today, matching the server-side "no future dates" rule)', () => {
    expect(taskDetailSrc).toMatch(/function todayDateInputValue/);
  });

  it('isCompleteValid requires a Completion Date to be set before the task can be completed', () => {
    expect(taskDetailSrc).toMatch(/isCompleteValid\s*=\s*completeForm\.serviceDetails\.trim\(\)\s*&&\s*completeForm\.amount\s*&&\s*parseFloat\(completeForm\.amount\)\s*>=\s*0\s*&&\s*!!completeForm\.actualCompletionDate/);
  });

  it('sends actualCompletionDate to the complete endpoint', () => {
    expect(taskDetailSrc).toMatch(/actualCompletionDate:\s*completeForm\.actualCompletionDate,/);
  });

  it('the completion modal still opens only from IN_PROGRESS and preserves the existing required fields (serviceDetails, amount, paymentMethod)', () => {
    expect(taskDetailSrc).toMatch(/workStatus === "IN_PROGRESS"/);
    expect(taskDetailSrc).toMatch(/serviceDetails:\s*completeForm\.serviceDetails/);
    expect(taskDetailSrc).toMatch(/completionAmount:\s*parseFloat\(completeForm\.amount\)/);
    // Bank Transfer subtype fix (Part D): resolved via resolvePaymentMethod().
    expect(taskDetailSrc).toMatch(/completionPaymentMethod:\s*resolvePaymentMethod\(\)/);
  });
});

describe('Scheduling AppointmentDetail: completion report + confirm operation', () => {
  it('defines a confirm-operation mutation calling PATCH /appointments/:id/confirm-operation', () => {
    expect(schedApptDetailSrc).toMatch(/api\.patch\(`\/appointments\/\$\{id\}\/confirm-operation`\)/);
  });

  it('only shows the completion report section for a COMPLETED appointment', () => {
    expect(schedApptDetailSrc).toMatch(/a\.workStatus === "COMPLETED" && \(/);
  });

  it('displays actualCompletionDate and serviceDetails, but never completionAmount', () => {
    expect(schedApptDetailSrc).toMatch(/a\.actualCompletionDate/);
    expect(schedApptDetailSrc).toMatch(/a\.serviceDetails/);
    expect(schedApptDetailSrc).not.toMatch(/completionAmount/);
    expect(schedApptDetailSrc).not.toMatch(/completionPaymentMethod/);
  });

  it('shows the Confirm Operation button only when not yet confirmed', () => {
    expect(schedApptDetailSrc).toMatch(/\{!a\.maintenanceConfirmed && \(/);
    expect(schedApptDetailSrc).toMatch(/confirmOperation\.mutate\(\)/);
  });

  it('shows a distinct confirmed/pending badge driven by maintenanceConfirmed', () => {
    expect(schedApptDetailSrc).toMatch(/a\.maintenanceConfirmed \? t\("appointments\.operationConfirmed"\) : t\("appointments\.awaitingMaintenanceConfirmation"\)/);
  });
});

describe('Scheduling Appointments list: confirmation column', () => {
  it('defines a confirm-operation mutation', () => {
    expect(schedApptsSrc).toMatch(/api\.patch\(`\/appointments\/\$\{id\}\/confirm-operation`\)/);
  });

  it('renders the confirmation column only meaningfully for COMPLETED appointments', () => {
    expect(schedApptsSrc).toMatch(/a\.workStatus !== "COMPLETED"/);
  });

  it('shows a Confirm Operation button for a completed-but-unconfirmed row', () => {
    expect(schedApptsSrc).toMatch(/confirmOperationMutation\.mutate\(a\.id\)/);
  });

  it('does not expose completionAmount anywhere in this list view', () => {
    expect(schedApptsSrc).not.toMatch(/completionAmount/);
  });
});

describe('Scheduling CustomerList maintenance-history: completion date + confirmation status', () => {
  it('displays actualCompletionDate and a confirmation-status badge for completed appointments', () => {
    expect(schedCustomerListSrc).toMatch(/a\.actualCompletionDate/);
    expect(schedCustomerListSrc).toMatch(/a\.maintenanceConfirmed \? t\("appointments\.operationConfirmed"\) : t\("appointments\.awaitingMaintenanceConfirmation"\)/);
  });

  it('still preserves the existing Modification #7 nextMaintenanceNote row', () => {
    expect(schedCustomerListSrc).toMatch(/a\.nextMaintenanceNote/);
    expect(schedCustomerListSrc).toMatch(/t\("tasks\.nextMaintenanceNote"\)/);
  });

  it('never exposes completionAmount in the history view', () => {
    expect(schedCustomerListSrc).not.toMatch(/completionAmount/);
  });
});
