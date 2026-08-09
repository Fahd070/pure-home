// Source-level regression tests for Modification #6 (Next Maintenance Note field +
// completion amount privacy). TaskDetail.tsx/AppointmentDetail.tsx/CustomerList.tsx/
// Technicians.tsx all call useQuery/useMutation/useTranslation directly with no
// injectable props, so rendering them here would require rebuilding their full
// provider stack for no real signal -- this project's established pattern for this
// class of full-page component (see rowActionButton.test.tsx, appointmentExport.test.ts)
// is source-level assertions instead.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const taskDetailSrc = fs.readFileSync(
  path.resolve(__dirname, '../../unified-app/src/technician/pages/TaskDetail.tsx'), 'utf-8'
);
const schedApptDetailSrc = fs.readFileSync(
  path.resolve(__dirname, '../../unified-app/src/scheduling/pages/AppointmentDetail.tsx'), 'utf-8'
);
const schedCustomerListSrc = fs.readFileSync(
  path.resolve(__dirname, '../../unified-app/src/scheduling/pages/CustomerList.tsx'), 'utf-8'
);
const adminTechniciansSrc = fs.readFileSync(
  path.resolve(__dirname, '../../unified-app/src/admin/pages/Technicians.tsx'), 'utf-8'
);
const i18nSrc = fs.readFileSync(
  path.resolve(__dirname, '../../unified-app/src/i18n.ts'), 'utf-8'
);

describe('Technician completion modal: Next Maintenance Note field', () => {
  it('adds nextMaintenanceNote to the completion form state, defaulting to empty', () => {
    expect(taskDetailSrc).toMatch(/nextMaintenanceNote:\s*""/);
  });

  it('renders an optional textarea for the note using the existing form style', () => {
    expect(taskDetailSrc).toMatch(/t\("tasks\.nextMaintenanceNote"\)/);
    expect(taskDetailSrc).toMatch(/value=\{completeForm\.nextMaintenanceNote\}/);
  });

  it('does not require the note -- isCompleteValid is unaffected by it', () => {
    expect(taskDetailSrc).toMatch(/const isCompleteValid = completeForm\.serviceDetails\.trim\(\) && completeForm\.amount && parseFloat\(completeForm\.amount\) >= 0;/);
    expect(taskDetailSrc).not.toMatch(/isCompleteValid[^;]*nextMaintenanceNote/);
  });

  it('sends a trimmed, non-empty note to the complete endpoint, and omits it when blank', () => {
    expect(taskDetailSrc).toMatch(/completeForm\.nextMaintenanceNote\.trim\(\)\s*\?\s*\{\s*nextMaintenanceNote:\s*completeForm\.nextMaintenanceNote\s*\}\s*:\s*\{\}/);
  });

  it('preserves the existing required fields (serviceDetails, amount, paymentMethod) unchanged', () => {
    expect(taskDetailSrc).toMatch(/serviceDetails:\s*completeForm\.serviceDetails/);
    expect(taskDetailSrc).toMatch(/completionAmount:\s*parseFloat\(completeForm\.amount\)/);
    expect(taskDetailSrc).toMatch(/completionPaymentMethod:\s*completeForm\.paymentMethod/);
  });
});

describe('Scheduling/Maintenance can view the Next Maintenance Note', () => {
  it('AppointmentDetail.tsx displays the note when present', () => {
    expect(schedApptDetailSrc).toMatch(/a\.nextMaintenanceNote/);
    expect(schedApptDetailSrc).toMatch(/t\("tasks\.nextMaintenanceNote"\)/);
  });

  it('CustomerList.tsx maintenance-history modal displays the note per appointment', () => {
    expect(schedCustomerListSrc).toMatch(/a\.nextMaintenanceNote/);
    expect(schedCustomerListSrc).toMatch(/t\("tasks\.nextMaintenanceNote"\)/);
  });

  it('neither scheduling screen references completionAmount (never shown to this role)', () => {
    expect(schedApptDetailSrc).not.toMatch(/completionAmount/);
    expect(schedCustomerListSrc).not.toMatch(/completionAmount/);
  });
});

describe('Admin technician-detail modal shows the Next Maintenance Note', () => {
  it('references taskDetail.task.nextMaintenanceNote', () => {
    expect(adminTechniciansSrc).toMatch(/taskDetail\.task\.nextMaintenanceNote/);
  });

  it('still gates the Payment section on completionAmount/completionPaymentMethod (unchanged)', () => {
    expect(adminTechniciansSrc).toMatch(/taskDetail\.task\.completionAmount != null \|\| taskDetail\.task\.completionPaymentMethod/);
  });
});

describe('i18n: nextMaintenanceNote key exists in both languages', () => {
  it('defines tasks.nextMaintenanceNote with the exact required Arabic and English labels', () => {
    expect(i18nSrc).toMatch(/nextMaintenanceNote:"ملاحظة الصيانة القادمة"/);
    expect(i18nSrc).toMatch(/nextMaintenanceNote:"Next Maintenance Note"/);
  });
});
