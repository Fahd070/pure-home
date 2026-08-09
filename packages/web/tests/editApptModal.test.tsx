// Regression tests for the appointment-edit modal ("تقرير الصيانة" /
// "Maintenance Report"). Date-picker-only simplification batch: the date/time
// fields (previously two manually-typed DD/MM/YYYY + HH:MM text fields from
// Modification #4) are now a single native <input type="date"> -- no time
// field at all. Covers both the admin (blue) and scheduling (green) copies of
// EditApptModal, which are independently duplicated in this codebase (not a
// shared component) -- both must behave identically here.
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
// keystroke/pick would be observed, before dispatching the input event.
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

    it('date field is a native date picker, locked to Gregorian/English digits, not a manual text field or datetime-local', () => {
      const el = render(<Modal appt={sampleAppt} onSave={() => {}} onClose={() => {}} />);
      const dateInput = el.querySelector('input[type="date"]') as HTMLInputElement;
      expect(dateInput).toBeTruthy();
      expect(dateInput.getAttribute('lang')).toBe('en-GB');
      expect(dateInput.getAttribute('dir')).toBe('ltr');
      expect(el.querySelector('input[type="datetime-local"]')).toBeNull();
      expect(el.querySelector('input[placeholder="15/06/2026"]')).toBeNull();
    });

    it('renders NO time field at all -- no type="time", no HH:MM text input, no "Time"/"الوقت" label', () => {
      const el = render(<Modal appt={sampleAppt} onSave={() => {}} onClose={() => {}} />);
      expect(el.querySelector('input[type="time"]')).toBeNull();
      expect(el.querySelector('input[placeholder="14:30"]')).toBeNull();
      expect(el.textContent).not.toContain('الوقت');
    });

    it('loads the existing date value correctly when editing, in native YYYY-MM-DD form', () => {
      const el = render(<Modal appt={sampleAppt} onSave={() => {}} onClose={() => {}} />);
      const dateInput = el.querySelector('input[type="date"]') as HTMLInputElement;
      expect(dateInput.value).toBe('2026-06-15');
    });

    it('submits the picked date through the same existing onSave/API flow, normalized to a deterministic end-of-day time', () => {
      const onSave = vi.fn();
      const el = render(<Modal appt={sampleAppt} onSave={onSave} onClose={() => {}} />);
      const dateInput = el.querySelector('input[type="date"]') as HTMLInputElement;
      act(() => { typeInto(dateInput, '2026-07-20'); });
      const saveButton = Array.from(el.querySelectorAll('button')).find(b => b.textContent === i18n.t('common.save'))!;
      act(() => { saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith('appt-1', {
        scheduledDate: '2026-07-20T23:59:59',
        type: 'MAINTENANCE',
        status: 'SCHEDULED',
        notes: 'test notes',
      });
    });

    it('blocks submission and shows an error when no date is selected, without calling onSave', () => {
      const onSave = vi.fn();
      const el = render(<Modal appt={{ ...sampleAppt, scheduledDate: '' }} onSave={onSave} onClose={() => {}} />);
      const saveButton = Array.from(el.querySelectorAll('button')).find(b => b.textContent === i18n.t('common.save'))!;
      act(() => { saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

      expect(onSave).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith(i18n.t('common.required'));
    });
  });
}
