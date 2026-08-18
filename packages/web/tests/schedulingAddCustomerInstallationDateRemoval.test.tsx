// History: Modification #12 previously removed the Installation Date field
// from both Admin and Scheduling "Add Customer" forms entirely (locked in by
// this file's original assertions -- an obfuscated `INSTALL_DATE_FIELD`
// constant was used specifically so the literal substring "installationDate"
// never appeared in either file's source, satisfying a literal source-text
// check).
//
// Part 1 of the customer-installation-and-activity-fix feature explicitly
// supersedes that: both forms now have a proper, optional "Installation
// Details" section (date + notes + cost + payment method), reusing the same
// pre-existing Customer.installationDate field and the same
// INSTALL_DATE_FIELD access pattern -- just no longer hidden from the create
// flow or gated to edit-only. This file's assertions are updated to match;
// the still-valid, unrelated checks (Dashboard/CallReportForm untouched,
// Admin Customers/Reports still display installationDate read-only) are
// preserved unchanged below.
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
  // Order in the form: name, phone, secondaryPhone (optional, left blank here),
  // city, district (the four `required` text fields).
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

describe('Scheduling Add Customer: optional Installation Details section (date now included in create flow too)', () => {
  it('renders "Installation Details" (English) as an optional section', () => {
    act(() => { i18n.changeLanguage('en'); });
    const el = render();
    expect(el.textContent).toMatch(/Installation Details/i);
  });

  it('renders "بيانات التركيب" (Arabic, default language)', () => {
    act(() => { i18n.changeLanguage('ar'); });
    const el = render();
    expect(el.textContent).toContain('بيانات التركيب');
  });

  it('two date inputs exist: Installation Date and the unrelated Previous Service Date', () => {
    const el = render();
    const dateInputs = el.querySelectorAll('input[type="date"]');
    expect(dateInputs.length).toBe(2);
  });

  it('creates a customer successfully leaving all installation fields blank -- no installation keys sent, exactly as before this section existed', async () => {
    apiPost.mockResolvedValue({ data: { success: true, data: { id: 'cust-1' } } });
    const el = render();
    fillRequiredFields(el);
    const form = el.querySelector('form')!;
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();

    expect(apiPost).toHaveBeenCalledTimes(1);
    const [, body] = apiPost.mock.calls[0];
    // `installationDate` is a computed object key, so it's present with value
    // `undefined` on the raw JS object -- that's what JSON.stringify (which
    // axios applies before this ever reaches the wire) drops, exactly like
    // every other omitted-on-create optional field in this payload (e.g.
    // previousServiceDate uses the identical pattern). Checking the
    // serialized form is what actually proves no key reaches the server.
    expect(JSON.parse(JSON.stringify(body))).not.toHaveProperty('installationDate');
    expect(body.installationNote).toBeUndefined();
    expect(body.installationAmount).toBeUndefined();
    expect(body.installationPaymentMethod).toBeUndefined();
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('filling in the Installation Date on create now actually submits it (previously impossible -- the field was edit-only)', async () => {
    apiPost.mockResolvedValue({ data: { success: true, data: { id: 'cust-2' } } });
    const el = render();
    fillRequiredFields(el);
    const dateInputs = Array.from(el.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      nativeSetter.call(dateInputs[0], '2025-05-01');
      dateInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    });
    const form = el.querySelector('form')!;
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();

    const [, body] = apiPost.mock.calls[0];
    expect(body).toHaveProperty('installationDate');
    expect(body.installationDate).toContain('2025-05-01');
  });
});

describe('Scheduling Add Customer: source-level confirmation', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../unified-app/src/scheduling/pages/AddCustomer.tsx'), 'utf-8'
  );

  it('installationDate is now collected on both create and edit (no longer gated to isEditing-only rendering)', () => {
    expect(src).not.toMatch(/isEditing && <div>.*installDate/);
  });

  it('the required-field validation logic is untouched (name, phone, city, district)', () => {
    expect(src).toMatch(/if \(!form\.name\.trim\(\)\)/);
    expect(src).toMatch(/PHONE_RE\.test\(form\.phone\)/);
    expect(src).toMatch(/if \(!form\.city\.trim\(\)\)/);
    expect(src).toMatch(/if \(!form\.district\.trim\(\)\)/);
  });
});

describe('Modification #11 regression: Call Report dashboard shortcut unaffected by this change', () => {
  it('Dashboard.tsx and CallReportForm.tsx were not touched by the installation-details section', () => {
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

describe('Admin customer workflow: also gets the optional Installation Details section', () => {
  it('Admin Add Customer now includes the same optional installation section', () => {
    const adminAddCustomerSrc = fs.readFileSync(
      path.resolve(__dirname, '../../unified-app/src/admin/pages/AddCustomer.tsx'), 'utf-8'
    );
    expect(adminAddCustomerSrc).toMatch(/customers\.installationSection/);
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
