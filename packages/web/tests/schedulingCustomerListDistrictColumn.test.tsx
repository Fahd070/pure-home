// Regression tests for Part 2: the Scheduling/Maintenance Customers table's
// location column now shows the district (الحي) instead of the city
// (المدينة), sourced from the customer's existing address.district field.
// This is a display-only change -- the backend already returned the full
// address (including district) via `include: { address: true }`, so no
// backend/API change was needed or made.
//
// No React Testing Library is installed in this project; rendering uses
// plain react-dom/client + act, matching appTitleBar.test.tsx.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import fs from 'fs';
import path from 'path';
import '../../unified-app/src/i18n';
import i18n from '../../unified-app/src/i18n';
import { useAppStore } from '../../unified-app/src/store/appStore';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const CUSTOMERS = [
  {
    id: 'c1',
    name: 'Customer One',
    phone: '0501111111',
    maintenanceCycle: 'MONTHLY',
    maintenanceFrequency: 1,
    nextMaintenance: null,
    daysUntil: null,
    alertLevel: 'ok',
    address: { city: 'Riyadh', district: 'Al Olaya', street: 'Main St' },
  },
];

const apiGet = vi.fn((url: string) => {
  if (url === '/customers') {
    return Promise.resolve({ data: { success: true, data: CUSTOMERS, meta: { total: CUSTOMERS.length } } });
  }
  return Promise.resolve({ data: { success: true, data: [] } });
});

vi.mock('../../unified-app/src/scheduling/api/client', () => ({
  api: { get: (...args: any[]) => apiGet(...(args as [string])) },
}));

let CustomerList: typeof import('../../unified-app/src/scheduling/pages/CustomerList').default;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let qc: QueryClient;

beforeEach(async () => {
  apiGet.mockClear();
  ({ default: CustomerList } = await import('../../unified-app/src/scheduling/pages/CustomerList'));
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    useAppStore.setState({ schedulingAuth: null, serverUrl: 'http://localhost:9999' });
  });
  i18n.changeLanguage('en');
});

afterEach(() => {
  if (root) { act(() => { root!.unmount(); }); root = null; }
  if (container) { container.remove(); container = null; }
  i18n.changeLanguage('ar');
});

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <CustomerList />
        </QueryClientProvider>
      </MemoryRouter>
    );
  });
  return container;
}

describe('Scheduling CustomerList table: district column', () => {
  it('table header reads "District", not "City"', async () => {
    const el = render();
    await flush();
    const headers = Array.from(el.querySelectorAll('th')).map((h) => h.textContent);
    expect(headers).toContain('District');
    expect(headers).not.toContain('City');
  });

  it('table cell shows address.district, not address.city', async () => {
    const el = render();
    await flush();
    const rowText = el.querySelector('tbody tr')?.textContent || '';
    expect(rowText).toContain('Al Olaya'); // district value
    expect(rowText).not.toContain('Riyadh'); // city value must not leak into this column
  });
});

// Source-level guard, matching this project's established pattern.
describe('Source: district-column change is table-display only', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../unified-app/src/scheduling/pages/CustomerList.tsx'),
    'utf-8'
  );
  const custDetailSrc = fs.readFileSync(
    path.resolve(__dirname, '../../unified-app/src/admin/pages/CustomerDetail.tsx'),
    'utf-8'
  );

  it('the table header/cell use customers.district / address?.district', () => {
    expect(src).toMatch(/\{t\("customers\.district"\)\}<\/th>/);
    expect(src).toMatch(/\{c\.address\?\.district \|\| "—"\}<\/td>/);
    // The old city-based cell must be gone from this table.
    expect(src).not.toMatch(/\{c\.address\?\.city \|\| "—"\}/);
  });

  it('CustomerDetail (shared by Admin and Scheduling) still shows the complete address, including city', () => {
    expect(custDetailSrc).toMatch(/addr\.city/);
    expect(custDetailSrc).toMatch(/addr\.district/);
    expect(custDetailSrc).toMatch(/addr\.street/);
  });
});
