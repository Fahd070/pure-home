// Modification #13: the required "Technician Name" (first name only) field
// in the Technician completion modal. Follows this project's established
// pattern for TaskDetail.tsx (see maintenanceConfirmation.test.ts) --
// source-level assertions for the modal wiring, plus direct unit tests
// against the exported firstNameOf()/FIRST_NAME_RE (the exact production
// pre-fill/validation logic, not a re-implementation).
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import i18n from '../../unified-app/src/i18n';
import { firstNameOf, FIRST_NAME_RE } from '../../unified-app/src/technician/pages/TaskDetail';

const taskDetailSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/technician/pages/TaskDetail.tsx'), 'utf-8');

describe('i18n: exact required labels', () => {
  it('tasks.technicianName matches the required Arabic/English wording', () => {
    expect(i18n.getFixedT('ar')('tasks.technicianName')).toBe('اسم الفني');
    expect(i18n.getFixedT('en')('tasks.technicianName')).toBe('Technician Name');
  });
  it('tasks.technicianNameRequired matches the required Arabic/English wording', () => {
    expect(i18n.getFixedT('ar')('tasks.technicianNameRequired')).toBe('اسم الفني مطلوب');
    expect(i18n.getFixedT('en')('tasks.technicianNameRequired')).toBe('Technician name is required');
  });
  it('tasks.technicianNameFirstOnly matches the required Arabic/English wording', () => {
    expect(i18n.getFixedT('ar')('tasks.technicianNameFirstOnly')).toBe('يرجى إدخال الاسم الأول فقط');
    expect(i18n.getFixedT('en')('tasks.technicianNameFirstOnly')).toBe('Please enter first name only');
  });
});

// 3, 4, 5: pre-fill derives the first name from the authenticated Technician's
// stored full name -- exact production function, not a re-implementation.
describe('firstNameOf(): pre-fill extraction (production logic)', () => {
  it('a full Latin name pre-fills only the first part ("Ahmed Ali" -> "Ahmed")', () => {
    expect(firstNameOf('Ahmed Ali')).toBe('Ahmed');
  });
  it('a three-part full Latin name still pre-fills only the first part', () => {
    expect(firstNameOf('Ahmed Ali Hassan')).toBe('Ahmed');
  });
  it('a full Arabic name pre-fills only the first part ("محمد أحمد علي" -> "محمد")', () => {
    expect(firstNameOf('محمد أحمد علي')).toBe('محمد');
  });
  it('a name that is already a single word is returned unchanged', () => {
    expect(firstNameOf('Khaled')).toBe('Khaled');
  });
  it('missing/empty stored name yields an empty pre-fill (no fabricated value)', () => {
    expect(firstNameOf(undefined)).toBe('');
    expect(firstNameOf(null)).toBe('');
    expect(firstNameOf('   ')).toBe('');
  });
});

describe('FIRST_NAME_RE: validation format (production logic)', () => {
  it('accepts a valid Latin first name', () => { expect(FIRST_NAME_RE.test('Ahmed')).toBe(true); });
  it('accepts a valid Arabic first name', () => { expect(FIRST_NAME_RE.test('محمد')).toBe(true); });
  it('accepts a hyphenated or apostrophe-containing single name', () => {
    expect(FIRST_NAME_RE.test("Jean-Paul")).toBe(true);
    expect(FIRST_NAME_RE.test("O'Brien")).toBe(true);
  });
  it('rejects a multi-word English name', () => { expect(FIRST_NAME_RE.test('Ahmed Ali')).toBe(false); });
  it('rejects a multi-word Arabic name', () => { expect(FIRST_NAME_RE.test('محمد أحمد')).toBe(false); });
  it('rejects an empty string', () => { expect(FIRST_NAME_RE.test('')).toBe(false); });
});

describe('Technician completion modal: Technician Name field', () => {
  it('adds technicianName to the completion form state, defaulting to empty', () => {
    expect(taskDetailSrc).toMatch(/technicianName:\s*""/);
  });

  it('renders a required Technician Name input with the correct label', () => {
    expect(taskDetailSrc).toMatch(/t\("tasks\.technicianName"\)/);
    expect(taskDetailSrc).toMatch(/type="text"\s+required\s+value=\{completeForm\.technicianName\}/);
  });

  it('pre-fills technicianName from the authenticated Technician on modal open', () => {
    expect(taskDetailSrc).toMatch(/import \{ useAuthStore \} from "\.\.\/store\/authStore"/);
    expect(taskDetailSrc).toMatch(/const \{ user \} = useAuthStore\(\);/);
    expect(taskDetailSrc).toMatch(/technicianName:\s*firstNameOf\(user\?\.name\)/);
  });

  it('isCompleteValid requires a valid technicianName before the task can be completed', () => {
    expect(taskDetailSrc).toMatch(/technicianNameValid\s*=\s*!!trimmedTechnicianName\s*&&\s*FIRST_NAME_RE\.test\(trimmedTechnicianName\)/);
    expect(taskDetailSrc).toMatch(/isCompleteValid\s*=[\s\S]*?&&\s*technicianNameValid;/);
  });

  it('shows a localized inline error only once the field is non-empty and invalid (not required-nagging on first open)', () => {
    expect(taskDetailSrc).toMatch(/technicianNameError\s*=\s*trimmedTechnicianName\s*&&\s*!technicianNameValid\s*\?\s*t\("tasks\.technicianNameFirstOnly"\)/);
  });

  it('sends the trimmed technicianName to the complete endpoint', () => {
    expect(taskDetailSrc).toMatch(/technicianName:\s*completeForm\.technicianName\.trim\(\),/);
  });

  it('resetting the modal clears technicianName back to empty (no stale value across appointments)', () => {
    expect(taskDetailSrc).toMatch(/function closeCompleteModal\(\) \{\s*setShowComplete\(false\);\s*setCompleteForm\(\{ \.\.\.EMPTY_COMPLETE \}\);/);
  });

  it('does not persist technicianName as a new database field name, and does not touch technicianId/assignment logic', () => {
    expect(taskDetailSrc).not.toMatch(/completionTechnicianName/);
    expect(taskDetailSrc).not.toMatch(/setTechnicianId|reassign/i);
  });

  it('the existing required fields (serviceDetails, amount, paymentMethod, actualCompletionDate) remain required and untouched', () => {
    expect(taskDetailSrc).toMatch(/serviceDetails:\s*completeForm\.serviceDetails/);
    expect(taskDetailSrc).toMatch(/completionAmount:\s*parseFloat\(completeForm\.amount\)/);
    expect(taskDetailSrc).toMatch(/completionPaymentMethod:\s*completeForm\.paymentMethod/);
    expect(taskDetailSrc).toMatch(/actualCompletionDate:\s*completeForm\.actualCompletionDate,/);
  });

  it('nextMaintenanceNote remains optional (unaffected by this modification)', () => {
    expect(taskDetailSrc).toMatch(/\(\{isAr \? "اختياري" : "Optional"\}\)/);
    expect(taskDetailSrc).toMatch(/nextMaintenanceNote:\s*completeForm\.nextMaintenanceNote/);
  });

  it('the postpone flow and urgent-location display are unaffected by this modification', () => {
    expect(taskDetailSrc).toMatch(/showPostpone/);
    expect(taskDetailSrc).toMatch(/appt\?\.urgentLocation/);
  });
});
