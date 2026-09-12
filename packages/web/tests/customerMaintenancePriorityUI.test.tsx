// v4 Requirement #5/#9: what the two customer lists actually render.
//
// The defect these cover is specifically a RENDERING one -- the backend has had
// the right classification since Phase 1, and both lists ignored it in favour of
// a legacy field, one of which ("overdueCount", a count of appointments) was
// being printed into a label that says "days".
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '../../unified-app/src/i18n';
import { useAppStore } from '../../unified-app/src/store/appStore';
import { waitFor } from './helpers/waitForCondition';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function makeCustomer(id: string, over: Record<string, unknown> = {}) {
  return {
    id, name: `Customer ${id}`, phone: '0500000000', isActive: true,
    maintenanceCycle: 'MONTHLY', maintenanceFrequency: 6,
    createdAt: '2026-01-01T00:00:00.000Z',
    address: { city: 'Riyadh', district: 'Olaya' },
    maintenancePriority: 'NORMAL', daysUntilMaintenance: 82, daysOverdue: null,
    nextMaintenanceDueAt: '2026-12-03T00:00:00.000Z',
    ...over,
  };
}

const ROWS = [
  makeCustomer('overdue', {
    maintenancePriority: 'OVERDUE', daysUntilMaintenance: -742, daysOverdue: 742,
    nextMaintenanceDueAt: '2024-09-01T00:00:00.000Z',
    // Deliberately present and deliberately NOT what the badge should read:
    // this is the field the old code printed into the "days" slot.
    overdueCount: 2, alertLevel: 'overdue', daysUntil: -742,
  }),
  makeCustomer('soon', {
    maintenancePriority: 'DUE_SOON', daysUntilMaintenance: 10, daysOverdue: null,
    nextMaintenanceDueAt: '2026-09-22T00:00:00.000Z',
  }),
  makeCustomer('normal'),
  makeCustomer('unknown', {
    maintenancePriority: 'UNKNOWN', daysUntilMaintenance: null, daysOverdue: null,
    nextMaintenanceDueAt: null,
  }),
];

const TOTAL = 130;

function pagedResponse(page: number, limit: number) {
  // Page 1 always carries the four interesting rows; the rest is filler so the
  // stepper has somewhere to go.
  const data = page === 1 ? ROWS : [makeCustomer(`p${page}`)];
  return { success: true, data, meta: { page, limit, total: TOTAL, totalPages: Math.ceil(TOTAL / limit) } };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let qc: QueryClient;

afterEach(() => {
  if (root) { act(() => { root!.unmount(); }); root = null; }
  if (container) { container.remove(); container = null; }
  vi.resetModules();
});

function mount(children: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter>
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  });
  return container;
}

const apiGet = vi.fn((url: string, config: any = {}) => {
  if (url === '/customers') {
    return Promise.resolve({ data: pagedResponse(config.params?.page ?? 1, config.params?.limit ?? 20) });
  }
  return Promise.resolve({ data: { success: true, data: [] } });
});

beforeEach(async () => {
  apiGet.mockClear();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => { useAppStore.setState({ adminAuth: null, schedulingAuth: null, serverUrl: 'http://localhost:9999' }); });
  await i18n.changeLanguage('ar');
});

async function mountAdmin() {
  vi.doMock('../../unified-app/src/admin/api/client', () => ({ api: { get: apiGet, patch: vi.fn(), delete: vi.fn() } }));
  const { default: Customers } = await import('../../unified-app/src/admin/pages/Customers');
  const el = mount(<Customers />);
  await waitFor(() => el.querySelectorAll('tbody tr').length === ROWS.length,
    { message: 'admin customer rows never rendered' });
  return el;
}

async function mountScheduling() {
  vi.doMock('../../unified-app/src/scheduling/api/client', () => ({ api: { get: apiGet, post: vi.fn(), patch: vi.fn() } }));
  const { default: CustomerList } = await import('../../unified-app/src/scheduling/pages/CustomerList');
  const el = mount(<CustomerList />);
  await waitFor(() => el.querySelectorAll('tbody tr').length === ROWS.length,
    { message: 'scheduling customer rows never rendered' });
  return el;
}

describe('Customer maintenance priority — Arabic', () => {
  it('renders the overdue label positively and never a negative day count', async () => {
    const el = await mountAdmin();
    expect(el.textContent).toContain('متأخر عن الصيانة 742 يوم');
    // The exact string the requirement forbids.
    expect(el.textContent).not.toContain('متبقي -742 يوم');
    expect(el.textContent).not.toContain('-742');
    // ...and specifically not the old behaviour of printing the appointment
    // count (2) as if it were a number of days.
    expect(el.textContent).not.toContain('متأخر عن الصيانة 2 يوم');
  });

  it('renders remaining days in the approved Arabic wording', async () => {
    const el = await mountAdmin();
    expect(el.textContent).toContain('متبقي 82 يوم');
    expect(el.textContent).toContain('متبقي 10 يوم');
  });

  it('shows a neutral, non-overdue state for a customer with no computable date', async () => {
    const el = await mountAdmin();
    expect(el.textContent).toContain('غير مجدول');
  });
});

describe('Customer maintenance priority — English', () => {
  beforeEach(async () => { await i18n.changeLanguage('en'); });

  it('renders natural English for both directions', async () => {
    const el = await mountAdmin();
    expect(el.textContent).toContain('Maintenance overdue by 742 days');
    expect(el.textContent).toContain('82 days remaining');
    expect(el.textContent).not.toContain('-742');
  });
});

describe('Overdue row emphasis', () => {
  it('tints the whole overdue row with semantic tokens, and leaves the others alone', async () => {
    const el = await mountAdmin();
    const rows = Array.from(el.querySelectorAll('tbody tr'));
    const overdueRow = rows[0];
    expect(overdueRow.className).toContain('bg-danger-bg');
    // Logical border property, so it flips side automatically in RTL.
    expect(overdueRow.className).toContain('border-s-danger-solid');
    expect(overdueRow.className).not.toContain('border-l-');
    expect(overdueRow.className).not.toContain('border-r-');
    // An emphasised row must not also carry the hover background that would
    // fight it for the same CSS property.
    expect(overdueRow.className).not.toContain('hover:bg-surface-hover');

    for (const row of rows.slice(1)) {
      expect(row.className).not.toContain('bg-danger-bg');
      expect(row.className).toContain('hover:bg-surface-hover');
    }
  });
});

describe('Customer list pagination UI', () => {
  it('asks the server for the maintenance ordering rather than sorting the page it got', async () => {
    await mountAdmin();
    const call = apiGet.mock.calls.find(c => c[0] === '/customers');
    expect(call![1].params.sort).toBe('maintenance');
    expect(call![1].params.page).toBe(1);
  });

  it('renders the stepper ABOVE the table, with the page, total pages and total count', async () => {
    const el = await mountAdmin();
    const table = el.querySelector('table')!;
    const prev = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes('السابق'))!;
    expect(prev).toBeTruthy();
    // Node.compareDocumentPosition: DOCUMENT_POSITION_FOLLOWING (4) means the
    // table comes after the control.
    expect(prev.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(el.textContent).toContain('صفحة');
    expect(el.textContent).toContain(String(TOTAL));
    expect(el.textContent).toContain('7'); // 130 rows / 20 per page
  });

  it('disables Previous on the first page and Next on the last', async () => {
    const el = await mountAdmin();
    const btn = (label: string) => Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes(label)) as HTMLButtonElement;
    expect(btn('السابق').disabled).toBe(true);
    expect(btn('التالي').disabled).toBe(false);

    act(() => { btn('التالي').click(); });
    await waitFor(() => apiGet.mock.calls.some(c => c[0] === '/customers' && c[1]?.params?.page === 2),
      { message: 'page 2 was never requested' });
    expect(btn('السابق').disabled).toBe(false);
  });

  it('resets to page 1 when the search changes', async () => {
    const el = await mountAdmin();
    const next = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes('التالي')) as HTMLButtonElement;
    act(() => { next.click(); });
    await waitFor(() => apiGet.mock.calls.some(c => c[1]?.params?.page === 2), { message: 'never reached page 2' });

    const input = el.querySelector('input') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, 'ahmed');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await waitFor(
      () => apiGet.mock.calls.some(c => c[1]?.params?.search === 'ahmed' && c[1]?.params?.page === 1),
      { message: 'search did not reset the page to 1' }
    );
  });

  it('gives the Scheduling list the same server pagination it previously had none of', async () => {
    const el = await mountScheduling();
    const call = apiGet.mock.calls.find(c => c[0] === '/customers');
    // It used to request a flat limit of 50 and render no navigation at all, so
    // customer 51 was unreachable.
    expect(call![1].params.limit).toBe(20);
    expect(call![1].params.sort).toBe('maintenance');
    expect(el.textContent).toContain('صفحة');
    expect(Array.from(el.querySelectorAll('button')).some(b => b.textContent?.includes('التالي'))).toBe(true);
  });
});
