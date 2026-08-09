// Modification #11: the Dashboard "Call Report" shortcut into the existing
// Call Reports subsystem. CallReportForm is rendered for real (with a mocked
// api client + auth store, matching this project's precedent for the one
// behavior worth verifying concretely -- see previousMaintenanceNote.test.tsx's
// race-safety harness) to prove pre-fill and stale-context safety. The
// Dashboard wiring itself (RowActionButton usage, modal mount/unmount) is
// checked at the source level, matching the established pattern for full-page
// components (appointmentExport.test.ts, maintenanceConfirmation.test.ts).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import fs from 'fs';
import path from 'path';
import i18n from '../../unified-app/src/i18n';

const { apiGet, apiPost } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../unified-app/src/scheduling/api/client', () => ({ api: { get: apiGet, post: apiPost } }));
vi.mock('../../unified-app/src/scheduling/store/authStore', () => ({
  useAuthStore: () => ({ user: { id: 'sched-user-1', name: 'Sched Employee' } }),
}));
const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: toastSuccess, error: vi.fn() } }));

// Imported AFTER the mocks above so the component picks up the mocked modules.
const { default: CallReportForm } = await import('../../unified-app/src/scheduling/components/CallReportForm');

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) { act(() => { root!.unmount(); }); root = null; }
  if (container) { container.remove(); container = null; }
  apiGet.mockReset();
  apiPost.mockReset();
  toastSuccess.mockClear();
});

function render(ui: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const qc = new QueryClient();
  act(() => { root!.render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>); });
  return container;
}

function flush() {
  return act(async () => { await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0)); });
}

const customerA = { id: 'cust-a', name: 'Customer A', phone: '0501111111' };
const customerB = { id: 'cust-b', name: 'Customer B', phone: '0502222222' };

describe('CallReportForm: pre-fill and stale-context safety', () => {
  it('pre-fills the customer context and locks out unregistered mode when a presetCustomer is given', async () => {
    apiGet.mockResolvedValue({ data: { data: [] } });
    const el = render(<CallReportForm presetCustomer={customerA} onSaved={() => {}} onCancel={() => {}} />);
    expect(el.textContent).toContain('Customer A');
    expect(el.textContent).toContain('0501111111');
    // callDate is now two manual DD/MM/YYYY + HH:MM text inputs (date-input-
    // normalization batch) instead of a native datetime-local picker; employeeName
    // input still exists; no search input or "unregistered customer" toggle when
    // the customer is already known.
    expect(el.querySelector('input[type="datetime-local"]')).toBeNull();
    expect(el.querySelector('input[placeholder="15/06/2026"]')).not.toBeNull();
    expect(el.querySelector('input[placeholder="14:30"]')).not.toBeNull();
    expect(el.textContent).not.toMatch(/Unregistered Customer|عميل غير مسجل/);
  });

  it("switching from Customer A's form to Customer B's shows only B's context (no stale data)", async () => {
    apiGet.mockResolvedValue({ data: { data: [] } });
    render(<CallReportForm presetCustomer={customerA} onSaved={() => {}} onCancel={() => {}} />);
    expect(container!.textContent).toContain('Customer A');

    const qc = new QueryClient();
    act(() => {
      root!.render(
        <QueryClientProvider client={qc}>
          <CallReportForm presetCustomer={customerB} onSaved={() => {}} onCancel={() => {}} />
        </QueryClientProvider>
      );
    });
    expect(container!.textContent).toContain('Customer B');
    expect(container!.textContent).not.toContain('Customer A');
    expect(container!.textContent).not.toContain('0501111111');
  });

  it('submits with the correct customerId for the customer currently loaded (not a stale one)', async () => {
    apiGet.mockResolvedValue({ data: { data: [] } });
    apiPost.mockResolvedValue({ data: { success: true, data: { id: 'report-1' } } });
    const onSaved = vi.fn();
    const el = render(<CallReportForm presetCustomer={customerB} onSaved={onSaved} onCancel={() => {}} />);

    const dateInput = el.querySelector('input[placeholder="15/06/2026"]') as HTMLInputElement;
    const timeInput = el.querySelector('input[placeholder="14:30"]') as HTMLInputElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    act(() => { nativeSetter.call(dateInput, '09/08/2026'); dateInput.dispatchEvent(new Event('input', { bubbles: true })); });
    act(() => { nativeSetter.call(timeInput, '10:00'); timeInput.dispatchEvent(new Event('input', { bubbles: true })); });

    const form = el.querySelector('form')!;
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();

    expect(apiPost).toHaveBeenCalledTimes(1);
    const [, body] = apiPost.mock.calls[0];
    expect(body.customerId).toBe('cust-b');
    expect(body.customerId).not.toBe('cust-a');
  });

  it('does not fetch the customer-search list at all when a presetCustomer is given (enabled:false)', () => {
    render(<CallReportForm presetCustomer={customerA} onSaved={() => {}} onCancel={() => {}} />);
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('disables the Save button while a submission is in flight (double-submission guard)', async () => {
    apiGet.mockResolvedValue({ data: { data: [] } });
    let resolvePost: (v: any) => void;
    apiPost.mockReturnValue(new Promise(r => { resolvePost = r; }));
    const el = render(<CallReportForm presetCustomer={customerA} onSaved={() => {}} onCancel={() => {}} />);

    const dateInput = el.querySelector('input[placeholder="15/06/2026"]') as HTMLInputElement;
    const timeInput = el.querySelector('input[placeholder="14:30"]') as HTMLInputElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    act(() => { nativeSetter.call(dateInput, '09/08/2026'); dateInput.dispatchEvent(new Event('input', { bubbles: true })); });
    act(() => { nativeSetter.call(timeInput, '10:00'); timeInput.dispatchEvent(new Event('input', { bubbles: true })); });

    const form = el.querySelector('form')!;
    act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();

    // The button becomes disabled while the request is in flight -- a real user
    // cannot click it again to fire a second submission (native browser behavior
    // for a disabled button; a raw synthetic DOM event bypasses that, so this
    // asserts the actual guard: the disabled attribute itself).
    const saveButton = Array.from(el.querySelectorAll('button')).find(b => b.type === 'submit') as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    expect(apiPost).toHaveBeenCalledTimes(1);

    await act(async () => { resolvePost!({ data: { success: true, data: { id: 'r1' } } }); await Promise.resolve(); });
  });
});

describe('Dashboard "Call Report" shortcut: source-level wiring', () => {
  const dashboardSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/scheduling/pages/Dashboard.tsx'), 'utf-8');
  const rowActionButtonSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/components/RowActionButton.tsx'), 'utf-8');
  const callReportsPageSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/scheduling/pages/CallReports.tsx'), 'utf-8');
  const callReportFormSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/scheduling/components/CallReportForm.tsx'), 'utf-8');

  it('i18n: callReports.action matches the required exact wording', () => {
    expect(i18n.getFixedT('ar')('callReports.action')).toBe('تقرير المكالمة');
    expect(i18n.getFixedT('en')('callReports.action')).toBe('Call Report');
  });

  it('RowActionButton gains a "call" variant, reused rather than a new button system', () => {
    expect(rowActionButtonSrc).toMatch(/"edit" \| "delete" \| "call"/);
  });

  it('the Dashboard appointment-list rows render the call-report action, guarded on a real customer', () => {
    expect(dashboardSrc).toMatch(/import CallReportModal from "\.\.\/components\/CallReportModal"/);
    expect(dashboardSrc).toMatch(/\{a\.customer && \(/);
    expect(dashboardSrc).toMatch(/variant="call"/);
    expect(dashboardSrc).toMatch(/setCallReportCustomer\(\{ id: a\.customer\.id, name: a\.customer\.name, phone: a\.customer\.phone \}\)/);
  });

  it('the modal state is fully replaced on open and cleared on close (no stale merge)', () => {
    expect(dashboardSrc).toMatch(/const \[callReportCustomer, setCallReportCustomer\] = useState/);
    expect(dashboardSrc).toMatch(/onClose=\{\(\) => setCallReportCustomer\(null\)\}/);
  });

  it('the standalone Call Reports page now reuses CallReportForm instead of a second inline implementation', () => {
    expect(callReportsPageSrc).toMatch(/import CallReportForm from "\.\.\/components\/CallReportForm"/);
    expect(callReportsPageSrc).toMatch(/<CallReportForm onSaved=\{\(\) => setShowForm\(false\)\} onCancel=\{\(\) => setShowForm\(false\)\} \/>/);
    // The old inline duplicated createMutation/handleSubmit logic must be gone.
    expect(callReportsPageSrc).not.toMatch(/const createMutation = useMutation/);
  });

  it('CallReportForm posts to the exact existing Call Reports endpoint (single source of truth)', () => {
    expect(callReportFormSrc).toMatch(/api\.post\("\/call-reports", body\)/);
    expect(callReportFormSrc).toMatch(/qc\.invalidateQueries\(\{ queryKey: \["call-reports"\] \}\)/);
  });

  it('the Save button is disabled while createMutation is pending (double-submit guard, source confirmation)', () => {
    expect(callReportFormSrc).toMatch(/disabled=\{createMutation\.isPending/);
  });

  it('does not introduce a reject/edit/delete flow beyond what already existed in the standalone page', () => {
    expect(callReportFormSrc.toLowerCase()).not.toMatch(/reject|decline/);
  });
});
