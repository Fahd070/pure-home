// Part 1: CustomerDetail displays the optional installation-details section
// (Installation Date / Notes / Cost / Payment Method), never the raw stored
// payment-method tag. Section is hidden entirely when every installation
// field is empty/null, matching this page's existing previousServiceType
// pattern. No React Testing Library is installed in this project; rendering
// uses plain react-dom/client + act, matching appTitleBar.test.tsx.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../../unified-app/src/i18n';
import i18n from '../../unified-app/src/i18n';
import CustomerDetail from '../../unified-app/src/admin/pages/CustomerDetail';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function baseCustomer(overrides: any = {}) {
  return {
    id: 'c1', name: 'Test Customer', phone: '0501234567', maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1,
    isActive: true, notes: null, createdAt: new Date().toISOString(), appointments: [],
    address: { city: 'Riyadh', district: 'Al Olaya', street: 'Main St' },
    installationDate: null, installationNote: null, installationAmount: null, installationPaymentMethod: null,
    previousServiceType: null,
    ...overrides,
  };
}

let apiGet: ReturnType<typeof vi.fn>;

vi.mock('../../unified-app/src/admin/api/client', () => ({
  api: { get: (...args: any[]) => apiGet(...args) },
}));

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let qc: QueryClient;

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  i18n.changeLanguage('en');
});

afterEach(() => {
  if (root) { act(() => { root!.unmount(); }); root = null; }
  if (container) { container.remove(); container = null; }
  i18n.changeLanguage('ar');
});

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

function render(customer: any) {
  apiGet = vi.fn(() => Promise.resolve({ data: { data: customer } }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter initialEntries={['/customers/c1']}>
        <QueryClientProvider client={qc}>
          <Routes>
            <Route path="/customers/:id" element={<CustomerDetail />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    );
  });
  return container;
}

describe('CustomerDetail: installation-details section', () => {
  it('shows the saved installation date, cost, payment method (translated, not raw), and note', async () => {
    const el = render(baseCustomer({
      installationDate: '2025-03-01T23:59:59.000Z',
      installationNote: 'Extra filter stage added',
      installationAmount: 450.5,
      installationPaymentMethod: 'BANK_CARD_PERSONAL',
    }));
    await flush();

    expect(el.textContent).toContain('Installation Details');
    expect(el.textContent).toContain('450.5');
    expect(el.textContent).toContain('Extra filter stage added');
    // Translated label, never the raw stored tag.
    expect(el.textContent).toContain('Personal Bank Card');
    expect(el.textContent).not.toContain('BANK_CARD_PERSONAL');
  });

  it('translates CASH and BANK_CARD_COMMERCIAL correctly too', async () => {
    const elCash = render(baseCustomer({ installationPaymentMethod: 'CASH', installationAmount: 10 }));
    await flush();
    expect(elCash.textContent).toContain('Cash');
    expect(elCash.textContent).not.toContain('CASH');

    const elCommercial = render(baseCustomer({ installationPaymentMethod: 'BANK_CARD_COMMERCIAL', installationAmount: 10 }));
    await flush();
    expect(elCommercial.textContent).toContain('Commercial Bank Card');
    expect(elCommercial.textContent).not.toContain('BANK_CARD_COMMERCIAL');
  });

  it('hides the installation section entirely when every field is empty/null', async () => {
    const el = render(baseCustomer());
    await flush();
    expect(el.textContent).not.toContain('Installation Details');
  });

  it('shows the section if only one field (e.g. a note) is set, others still null', async () => {
    const el = render(baseCustomer({ installationNote: 'Just a note' }));
    await flush();
    expect(el.textContent).toContain('Installation Details');
    expect(el.textContent).toContain('Just a note');
  });

  it('a customer with only a legacy installationDate (no note/cost/payment) still shows the section', async () => {
    const el = render(baseCustomer({ installationDate: '2024-01-01T23:59:59.000Z' }));
    await flush();
    expect(el.textContent).toContain('Installation Details');
  });
});
