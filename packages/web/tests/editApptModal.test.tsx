// Regression tests for Modification #4: the appointment-edit modal's title
// renamed from "تعديل الموعد" ("Edit Appointment") to "تقرير الصيانة"
// ("Maintenance Report"), and its date/time fields switched from a native
// <input type="datetime-local"> picker to two manually-typed text fields
// (DD/MM/YYYY, HH:MM). Covers both the admin (blue) and scheduling (green)
// copies of EditApptModal, which are independently duplicated in this
// codebase (not a shared component) -- both must behave identically here.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import i18n from '../../unified-app/src/i18n';
import { EditApptModal as AdminEditApptModal } from '../../unified-app/src/admin/pages/Dashboard';
import { EditApptModal as SchedEditApptModal } from '../../unified-app/src/scheduling/pages/Dashboard';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { error: toastError, success: vi.fn() } }));

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) { act(() => { root!.unmount(); }); root = null; }
  if (container) { container.remove(); container = null; }
  toastError.mockClear();
});

// Setting `.value` directly does not trigger React's controlled-input
// change detection (React overrides the native property setter to track
// changes); this invokes that native setter first, matching how a real
// keystroke would be observed, before dispatching the input event.
function typeInto(input: HTMLInputElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  nativeSetter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function render(ui: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(ui); });
  return container;
}

const sampleAppt = { id: 'appt-1', scheduledDate: '2026-06-15T14:30:00.000Z', type: 'MAINTENANCE', status: 'SCHEDULED', notes: 'test notes' };

// Runs the full suite against both the admin and scheduling copies of the modal.
const variants: Array<{ name: string; Modal: typeof AdminEditApptModal }> = [
  { name: 'admin', Modal: AdminEditApptModal },
  { name: 'scheduling', Modal: SchedEditApptModal },
];

for (const { name, Modal } of variants) {
  describe(`EditApptModal (${name})`, () => {
    it('renders "تقرير الصيانة" as the modal title', () => {
      const el = render(<Modal appt={sampleAppt} onSave={() => {}} onClose={() => {}} />);
      expect(el.textContent).toContain(i18n.t('dashboard.editApptTitle'));
      expect(i18n.t('dashboard.editApptTitle')).toBe('تقرير الصيانة');
    });

    it('no longer shows "تعديل الموعد" anywhere in the modal', () => {
      const el = render(<Modal appt={sampleAppt} onSave={() => {}} onClose={() => {}} />);
      expect(el.textContent).not.toContain('تعديل الموعد');
    });

    it('date input is a plain text field, not a date/datetime picker', () => {
      const el = render(<Modal appt={sampleAppt} onSave={() => {}} onClose={() => {}} />);
      const dateInput = el.querySelector('input[placeholder="15/06/2026"]') as HTMLInputElement;
      expect(dateInput).toBeTruthy();
      expect(dateInput.type).toBe('text');
      expect(el.querySelector('input[type="date"]')).toBeNull();
      expect(el.querySelector('input[type="datetime-local"]')).toBeNull();
    });

    it('time input is a plain text field, not a time picker', () => {
      const el = render(<Modal appt={sampleAppt} onSave={() => {}} onClose={() => {}} />);
      const timeInput = el.querySelector('input[placeholder="14:30"]') as HTMLInputElement;
      expect(timeInput).toBeTruthy();
      expect(timeInput.type).toBe('text');
      expect(el.querySelector('input[type="time"]')).toBeNull();
    });

    it('loads the existing date value correctly when editing (DD/MM/YYYY)', () => {
      const el = render(<Modal appt={sampleAppt} onSave={() => {}} onClose={() => {}} />);
      const dateInput = el.querySelector('input[placeholder="15/06/2026"]') as HTMLInputElement;
      expect(dateInput.value).toBe('15/06/2026');
    });

    it('loads the existing time value correctly when editing (HH:MM)', () => {
      const el = render(<Modal appt={sampleAppt} onSave={() => {}} onClose={() => {}} />);
      const timeInput = el.querySelector('input[placeholder="14:30"]') as HTMLInputElement;
      expect(timeInput.value).toBe('14:30');
    });

    it('submits the manually-entered values through the same existing onSave/API flow, in the exact same payload shape as before', () => {
      const onSave = vi.fn();
      const el = render(<Modal appt={sampleAppt} onSave={onSave} onClose={() => {}} />);
      const dateInput = el.querySelector('input[placeholder="15/06/2026"]') as HTMLInputElement;
      const timeInput = el.querySelector('input[placeholder="14:30"]') as HTMLInputElement;
      act(() => { typeInto(dateInput, '20/07/2026'); });
      act(() => { typeInto(timeInput, '09:15'); });
      const saveButton = Array.from(el.querySelectorAll('button')).find(b => b.textContent === i18n.t('common.save'))!;
      act(() => { saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith('appt-1', {
        scheduledDate: '2026-07-20T09:15',
        type: 'MAINTENANCE',
        status: 'SCHEDULED',
        notes: 'test notes',
      });
    });

    it('blocks submission and shows an error when the typed date is invalid, without calling onSave', () => {
      const onSave = vi.fn();
      const el = render(<Modal appt={sampleAppt} onSave={onSave} onClose={() => {}} />);
      const dateInput = el.querySelector('input[placeholder="15/06/2026"]') as HTMLInputElement;
      act(() => { typeInto(dateInput, '31/04/2026'); }); // April has 30 days
      const saveButton = Array.from(el.querySelectorAll('button')).find(b => b.textContent === i18n.t('common.save'))!;
      act(() => { saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

      expect(onSave).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith(i18n.t('dashboard.invalidDateTime'));
    });

    it('blocks submission and shows an error when the typed time is invalid, without calling onSave', () => {
      const onSave = vi.fn();
      const el = render(<Modal appt={sampleAppt} onSave={onSave} onClose={() => {}} />);
      const timeInput = el.querySelector('input[placeholder="14:30"]') as HTMLInputElement;
      act(() => { typeInto(timeInput, '99:99'); });
      const saveButton = Array.from(el.querySelectorAll('button')).find(b => b.textContent === i18n.t('common.save'))!;
      act(() => { saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

      expect(onSave).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith(i18n.t('dashboard.invalidDateTime'));
    });
  });
}
