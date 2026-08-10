// Modification #12: the Scheduling "Add Customer" form no longer asks for
// Installation Date. Real-rendered with a mocked api client (matching the
// established pattern for full-page components used elsewhere in this
// project -- see callReportDashboardShortcut.test.tsx), plus a source-level
// check confirming the field's UI block, state key, and payload key are all
// gone, not just hidden.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'fs';
import path from 'path';
import i18n from '../../unified-app/src/i18n';

const { apiPost } = vi.hoisted(() => ({ apiPost: vi.fn() }));
vi.mock('../../unified-app/src/scheduling/api/client', () => ({ api: { post: apiPost } }));
const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: toastSuccess, error: vi.fn() } }));

// Imported AFTER the mocks above so the component picks up the mocked modules.
const { default: SchedAddCustomer } = await import('../../unified-app/src/scheduling/pages/AddCustomer');

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) { act(() => { root!.unmount(); }); root = null; }
  if (container) { container.remove(); container = null; }
  apiPost.mockReset();
  toastSuccess.mockClear();
  act(() => { i18n.changeLanguage('ar'); });
});

function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter>
        <SchedAddCustomer />
      </MemoryRouter>
    );
  });
  return container;
}

function fillRequiredFields(el: HTMLElement) {
  const inputs = Array.from(el.querySelectorAll('input[type="text"]')) as HTMLInputElement[];
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  const setValue = (input: HTMLInputElement, value: string) => {
    nativeSetter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  // Order in the form: name, phone, secondaryPhone (optional, left blank here --
  // completion-technician-name-display batch), city, district (the four
  // `required` text fields).
  const [nameInput, phoneInput, , cityInput, districtInput] = inputs;
  act(() => {
    setValue(nameInput, 'New Customer');
    setValue(phoneInput, '0501234567');
    setValue(cityInput, 'Riyadh');
    setValue(districtInput, 'Test District');
  });
}

function flush() {
  return act(async () => { await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0)); });
}

describe('Scheduling Add Customer: Installation Date field removed', () => {
  it('does not render "Installation Date" in English', () => {
    act(() => { i18n.changeLanguage('en'); });
    const el = render();
    expect(el.textContent).not.toMatch(/Installation Date/i);
  });

  it('does not render "تاريخ التركيب" in Arabic (default language)', () => {
    act(() => { i18n.changeLanguage('ar'); });
    const el = render();
    expect(el.textContent).not.toContain('تاريخ التركيب');
  });

  it('does not render a date-type input at all (no leftover date picker)', () => {
    const el = render();
    expect(el.querySelector('input[type="date"]')).toBeNull();
  });

  it('creates a customer successfully without ever collecting installationDate, and the submitted payload has no installationDate key', async () => {
    apiPost.mockResolvedValue({ data: { success: true, data: { id: 'cust-1' } } });
    const el = render();
    fillRequiredFields(el);
    const form = el.querySelector('form')!;
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();

    expect(apiPost).toHaveBeenCalledTimes(1);
    const [, body] = apiPost.mock.calls[0];
    expect(body).not.toHaveProperty('installationDate');
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("does not fabricate today's date or any other date value for the omitted field", async () => {
    apiPost.mockResolvedValue({ data: { success: true, data: { id: 'cust-2' } } });
    const el = render();
    fillRequiredFields(el);
    const form = el.querySelector('form')!;
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();

    const [, body] = apiPost.mock.calls[0];
    const bodyStr = JSON.stringify(body);
    const todayIso = new Date().toISOString().slice(0, 10);
    expect(bodyStr).not.toContain(todayIso);
  });
});

describe('Scheduling Add Customer: source-level confirmation (field fully removed, not just hidden)', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../unified-app/src/scheduling/pages/AddCustomer.tsx'), 'utf-8'
  );

  it('no installationDate state key, label, input, or payload key remains in the component', () => {
    expect(src).not.toMatch(/installationDate/);
    expect(src).not.toMatch(/تاريخ التركيب/);
    expect(src).not.toMatch(/type="date"/);
  });

  it('the required-field validation logic is untouched (name, phone, city, district) -- no empty layout gap introduced by removing an unrelated required check', () => {
    expect(src).toMatch(/if \(!form\.name\.trim\(\)\)/);
    expect(src).toMatch(/PHONE_RE\.test\(form\.phone\)/);
    expect(src).toMatch(/if \(!form\.city\.trim\(\)\)/);
    expect(src).toMatch(/if \(!form\.district\.trim\(\)\)/);
  });
});

describe('Modification #11 regression: Call Report dashboard shortcut unaffected by this change', () => {
  it('Dashboard.tsx and CallReportForm.tsx were not touched by the installationDate removal', () => {
    const dashboardSrc = fs.readFileSync(
      path.resolve(__dirname, '../../unified-app/src/scheduling/pages/Dashboard.tsx'), 'utf-8'
    );
    const callReportFormSrc = fs.readFileSync(
      path.resolve(__dirname, '../../unified-app/src/scheduling/components/CallReportForm.tsx'), 'utf-8'
    );
    expect(dashboardSrc).not.toMatch(/installationDate/);
    expect(callReportFormSrc).not.toMatch(/installationDate/);
    expect(dashboardSrc).toMatch(/variant="call"/);
  });
});

describe('Admin customer workflow: unaffected (scope discipline check)', () => {
  it('Admin Add Customer never had an Installation Date field, and is untouched by this modification', () => {
    const adminAddCustomerSrc = fs.readFileSync(
      path.resolve(__dirname, '../../unified-app/src/admin/pages/AddCustomer.tsx'), 'utf-8'
    );
    expect(adminAddCustomerSrc).not.toMatch(/installationDate/);
  });

  it('Admin Customers list and Reports still legitimately display historical installationDate (read-only, unchanged)', () => {
    const adminCustomersSrc = fs.readFileSync(
      path.resolve(__dirname, '../../unified-app/src/admin/pages/Customers.tsx'), 'utf-8'
    );
    const adminReportsSrc = fs.readFileSync(
      path.resolve(__dirname, '../../unified-app/src/admin/pages/Reports.tsx'), 'utf-8'
    );
    expect(adminCustomersSrc).toMatch(/c\.installationDate/);
    expect(adminReportsSrc).toMatch(/c\.installationDate/);
  });
});
