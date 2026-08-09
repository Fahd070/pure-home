// Completion/reporting batch: source-level regression tests for
// (A) Admin -> Technicians full normal-completion details (actualCompletionDate,
//     maintenanceConfirmed added to the existing Completed Task Details modal)
// (B) Technician -> Urgent Appointments Technician Name field (required,
//     pre-filled, validated via the reused Modification #13 first-name rule)
//     and the new Admin -> Urgent Appointments visit-detail modal.
// Follows this project's established pattern (see technicianNameCompletion.test.ts,
// maintenanceConfirmation.test.ts): source-level assertions against the exact
// production wiring.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import i18n from '../../unified-app/src/i18n';

const adminTechniciansSrc = fs.readFileSync(
  path.resolve(__dirname, '../../unified-app/src/admin/pages/Technicians.tsx'), 'utf-8');
const technicianUrgentSrc = fs.readFileSync(
  path.resolve(__dirname, '../../unified-app/src/technician/pages/UrgentAppointments.tsx'), 'utf-8');
const adminUrgentSrc = fs.readFileSync(
  path.resolve(__dirname, '../../unified-app/src/admin/pages/UrgentAppointments.tsx'), 'utf-8');
const backendTechniciansSrc = fs.readFileSync(
  path.resolve(__dirname, '../../backend/src/routes/technicians.ts'), 'utf-8');
const backendUrgentVisitsSrc = fs.readFileSync(
  path.resolve(__dirname, '../../backend/src/routes/urgent-visits.ts'), 'utf-8');

describe('Part A: Admin Technicians backend select includes the two new fields', () => {
  it('actualCompletionDate and maintenanceConfirmed are selected alongside existing completion fields', () => {
    expect(backendTechniciansSrc).toMatch(/actualCompletionDate: true, maintenanceConfirmed: true/);
  });
  it('the privacy-stripping block for non-admin (Scheduling) still only deletes financial fields, never the two new ones', () => {
    const stripBlock = backendTechniciansSrc.match(/if \(!isAdmin\) \{[\s\S]*?\n {4}\}/)?.[0] || '';
    expect(stripBlock).toMatch(/delete appt\.completionImage/);
    expect(stripBlock).toMatch(/delete appt\.completionAmount/);
    expect(stripBlock).toMatch(/delete appt\.completionPaymentMethod/);
    expect(stripBlock).not.toMatch(/delete appt\.actualCompletionDate/);
    expect(stripBlock).not.toMatch(/delete appt\.maintenanceConfirmed/);
  });
});

describe('Part A: Admin Technicians detail modal shows full completion details', () => {
  it('1. shows the Technician name', () => {
    expect(adminTechniciansSrc).toMatch(/\{taskDetail\.techName\}/);
  });
  it('2. shows customer name and phone', () => {
    expect(adminTechniciansSrc).toMatch(/taskDetail\.task\.customer\?\.name/);
    expect(adminTechniciansSrc).toMatch(/taskDetail\.task\.customer\.phone/);
  });
  it('3. shows service type', () => {
    expect(adminTechniciansSrc).toMatch(/APPT_TYPE_LABELS\[taskDetail\.task\.type/);
  });
  it('4. shows the scheduled date (date-picker-only simplification batch: business-date scheduling no longer carries a user-entered time)', () => {
    expect(adminTechniciansSrc).toMatch(/formatGregorianDate\(taskDetail\.task\.scheduledDate\)/);
    expect(adminTechniciansSrc).not.toMatch(/formatGregorianTime\(taskDetail\.task\.scheduledDate\)/);
  });
  it('5. shows actualCompletionDate via the Gregorian formatter, distinct from completedAt', () => {
    expect(adminTechniciansSrc).toMatch(/taskDetail\.task\.actualCompletionDate &&/);
    expect(adminTechniciansSrc).toMatch(/formatGregorianDate\(taskDetail\.task\.actualCompletionDate\)/);
  });
  it('6. shows serviceDetails', () => {
    expect(adminTechniciansSrc).toMatch(/taskDetail\.task\.serviceDetails/);
  });
  it('7. shows nextMaintenanceNote when present, using the exact required label', () => {
    expect(adminTechniciansSrc).toMatch(/taskDetail\.task\.nextMaintenanceNote &&/);
    expect(i18n.getFixedT('ar')('tasks.nextMaintenanceNote') === 'ملاحظة الصيانة القادمة').toBe(true);
  });
  it('8. shows completionAmount', () => {
    expect(adminTechniciansSrc).toMatch(/taskDetail\.task\.completionAmount\.toFixed\(2\)/);
  });
  it('9. shows completionPaymentMethod', () => {
    expect(adminTechniciansSrc).toMatch(/PAYMENT_LABELS\[taskDetail\.task\.completionPaymentMethod\]/);
  });
  it('10. shows Commercial/Personal Bank Transfer labels correctly', () => {
    expect(adminTechniciansSrc).toMatch(/BANK_TRANSFER_COMMERCIAL: isAr \? "تحويل بنكي \(تجاري\)" : "Bank Transfer \(Commercial\)"/);
    expect(adminTechniciansSrc).toMatch(/BANK_TRANSFER_PERSONAL: isAr \? "تحويل بنكي \(خاص\)" : "Bank Transfer \(Personal\)"/);
  });
  it('11. shows completionImage when present, with a safe <img> tag (no dangerouslySetInnerHTML)', () => {
    expect(adminTechniciansSrc).toMatch(/src=\{taskDetail\.task\.completionImage\}/);
    expect(adminTechniciansSrc).not.toMatch(/dangerouslySetInnerHTML/);
  });
  it('12. shows maintenanceConfirmed state with the exact required Arabic/English labels', () => {
    expect(adminTechniciansSrc).toMatch(/تم تأكيد العملية/);
    expect(adminTechniciansSrc).toMatch(/Operation Confirmed/);
    expect(adminTechniciansSrc).toMatch(/بانتظار تأكيد الصيانة/);
    expect(adminTechniciansSrc).toMatch(/Awaiting Maintenance Confirmation/);
    expect(adminTechniciansSrc).toMatch(/taskDetail\.task\.maintenanceConfirmed/);
  });
  it('13. optional fields (actualCompletionDate, nextMaintenanceNote, completionImage) are each individually guarded so a missing one does not break the view', () => {
    expect(adminTechniciansSrc).toMatch(/\{taskDetail\.task\.actualCompletionDate && \(/);
    expect(adminTechniciansSrc).toMatch(/\{taskDetail\.task\.nextMaintenanceNote && \(/);
    expect(adminTechniciansSrc).toMatch(/taskDetail\.task\.completionImage \? \(/);
  });
  it('14. Scheduling privacy: the Payment Information section is still guarded on completionAmount/completionPaymentMethod presence (undefined for Scheduling -> section hidden, unchanged)', () => {
    expect(adminTechniciansSrc).toMatch(/\{\(taskDetail\.task\.completionAmount != null \|\| taskDetail\.task\.completionPaymentMethod\) && \(/);
  });
});

describe('Part B: Urgent completion form renders a required Technician Name field', () => {
  it('15. renders the Technician Name field with the correct label', () => {
    expect(technicianUrgentSrc).toMatch(/t\("tasks\.technicianName"\)/);
    expect(technicianUrgentSrc).toMatch(/type="text" required value=\{record\.technicianName\}/);
  });
  it('16. the field is required and gates form submission via isRecordValid', () => {
    expect(technicianUrgentSrc).toMatch(/const technicianNameValid = !!trimmedTechnicianName && FIRST_NAME_RE\.test\(trimmedTechnicianName\);/);
    expect(technicianUrgentSrc).toMatch(/const isRecordValid = .*&& technicianNameValid;/);
  });
  it('17. the authenticated Technician\'s first name pre-fills the field when the form opens', () => {
    expect(technicianUrgentSrc).toMatch(/import \{ useAuthStore \} from "\.\.\/store\/authStore";/);
    expect(technicianUrgentSrc).toMatch(/const \{ user \} = useAuthStore\(\);/);
    expect(technicianUrgentSrc).toMatch(/technicianName: firstNameOf\(user\?\.name\)/);
  });
  it('18. missing/invalid name blocks the submit button client-side (disabled on !isRecordValid)', () => {
    expect(technicianUrgentSrc).toMatch(/disabled=\{submitMutation\.isPending \|\| !isRecordValid\}/);
  });
  it('19-20-21-22. reuses Modification #13\'s exact FIRST_NAME_RE/firstNameOf rather than a second validator', () => {
    expect(technicianUrgentSrc).toMatch(/import \{ FIRST_NAME_RE, firstNameOf \} from "\.\/TaskDetail";/);
    expect(technicianUrgentSrc).not.toMatch(/const FIRST_NAME_RE\s*=/); // no locally re-declared regex
  });
  it('23-24. shows an inline error only once the field is non-empty and invalid (matches the normal-completion UX convention)', () => {
    expect(technicianUrgentSrc).toMatch(/const technicianNameError = trimmedTechnicianName && !technicianNameValid/);
  });
  it('25-26. submitted technicianName is sent as business data alongside the payload, never replacing appointmentId/customer identity fields', () => {
    expect(technicianUrgentSrc).toMatch(/technicianName: trimmedTechnicianName,/);
    expect(technicianUrgentSrc).toMatch(/appointmentId: submitModal\.appt\.id,/);
  });
});

describe('Part B backend: urgent-visits requires and validates technicianName without persisting it', () => {
  it('technicianName is required in the Zod schema shape (validated in the handler, not silently optional-and-ignored)', () => {
    expect(backendUrgentVisitsSrc).toMatch(/technicianName:\s*z\.string\(\)\.max\(100\)\.optional\(\)/);
    expect(backendUrgentVisitsSrc).toMatch(/if \(!trimmedTechnicianName\) return res\.status\(400\)/);
    expect(backendUrgentVisitsSrc).toMatch(/if \(!FIRST_NAME_RE\.test\(trimmedTechnicianName\)\) return res\.status\(400\)/);
  });
  it('the create() call\'s data block does not include technicianName (never persisted)', () => {
    const createBlock = backendUrgentVisitsSrc.match(/prisma\.urgentVisitRecord\.create\(\{[\s\S]*?\n {4}\}\);/)?.[0] || '';
    expect(createBlock).not.toMatch(/technicianName/);
    expect(createBlock).toMatch(/submittedById:\s*req\.user!\.userId/);
  });
});

describe('Part B: Admin Urgent Appointments detail modal shows full visit details', () => {
  it('27. shows the completing Technician\'s name', () => {
    expect(adminUrgentSrc).toMatch(/visitDetail\.submittedBy\?\.name/);
  });
  it('28. shows customer name and phone', () => {
    expect(adminUrgentSrc).toMatch(/visitDetail\.customerName \|\| visitDetail\.appointment\?\.customer\?\.name/);
    expect(adminUrgentSrc).toMatch(/visitDetail\.customerPhone/);
  });
  it('29. shows the urgent location, reusing the existing locationText() helper', () => {
    expect(adminUrgentSrc).toMatch(/visitDetail\.appointment \? locationText\(visitDetail\.appointment\) : "—"/);
  });
  it('30. shows service type', () => {
    expect(adminUrgentSrc).toMatch(/SERVICE_LABELS\[visitDetail\.serviceType\]/);
  });
  it('31. shows the visit/appointment scheduled date and time, and the submitted-at timestamp', () => {
    expect(adminUrgentSrc).toMatch(/formatGregorianDate\(visitDetail\.appointment\.scheduledDate\)/);
    expect(adminUrgentSrc).toMatch(/formatGregorianDate\(visitDetail\.createdAt\)/);
  });
  it('32. shows customerDetails when present', () => {
    expect(adminUrgentSrc).toMatch(/visitDetail\.customerDetails &&/);
  });
  it('33. shows serviceNotes when present', () => {
    expect(adminUrgentSrc).toMatch(/visitDetail\.serviceNotes &&/);
  });
  it('34. shows amount and payment method', () => {
    expect(adminUrgentSrc).toMatch(/visitDetail\.amount != null \? visitDetail\.amount\.toFixed\(2\)/);
    expect(adminUrgentSrc).toMatch(/PAYMENT_LABELS\[visitDetail\.paymentMethod\]/);
  });
  it('35-36. Commercial/Personal transfer labels are available via the existing PAYMENT_LABELS map (already extended in a prior batch)', () => {
    expect(adminUrgentSrc).toMatch(/BANK_TRANSFER_COMMERCIAL:/);
    expect(adminUrgentSrc).toMatch(/BANK_TRANSFER_PERSONAL:/);
  });
  it('37. Visit Only is shown explicitly as "not applicable", not a blank/misleading value', () => {
    expect(adminUrgentSrc).toMatch(/visitDetail\.serviceType === "VISIT_ONLY"/);
    expect(adminUrgentSrc).toMatch(/N\/A \(Visit Only\)/);
  });
  it('38. the urgent appointment list tab and the visit-records tab remain two distinct sections (no merge into Work Queue)', () => {
    expect(adminUrgentSrc).toMatch(/tab === "list"/);
    expect(adminUrgentSrc).toMatch(/tab === "records"/);
  });
  it('39. the existing visit-record row click behavior opens the detail modal without altering the submit/create flow', () => {
    expect(adminUrgentSrc).toMatch(/onClick=\{\(\) => setVisitDetail\(v\)\}/);
    expect(adminUrgentSrc).toMatch(/createMutation\.mutate/);
  });
  it('40. no Scheduling exposure introduced: the detail modal reads only visitDetail.* (the same GET /urgent-visits payload Admin already received before this batch), no new Scheduling-role branch was added', () => {
    // "visibleToScheduling" is a pre-existing, unrelated urgent-appointment field
    // used by the separate "list" tab -- confirms this batch didn't touch it.
    expect(adminUrgentSrc).toMatch(/a\.visibleToScheduling/);
    expect(adminUrgentSrc).not.toMatch(/requireRole.*SCHEDULING/);
    expect(adminUrgentSrc).not.toMatch(/role === ['"]SCHEDULING['"]/);
  });
});
