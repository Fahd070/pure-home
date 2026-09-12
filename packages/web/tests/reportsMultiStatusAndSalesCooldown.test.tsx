// v4 Requirement #10: the Reports page.
//
// Three separate defects, covered together because they share one screen:
//   A. Sales reports were locked behind a browser-side countdown.
//   B. Appointment reports allowed one status, shown as a raw enum value.
//   C. Customer reports allowed one status.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '../../unified-app/src/i18n';
import { useAppStore } from '../../unified-app/src/store/appStore';
import { waitFor } from './helpers/waitForCondition';
import {
  appointmentReportStatus,
  appointmentStatusLabel,
  appointmentStatusLabels,
  statusParam,
  APPOINTMENT_REPORT_STATUSES,
} from '../../unified-app/src/utils/reportStatus';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const source = (file: string) => fs.readFileSync(path.resolve(__dirname, '../../unified-app/src', file), 'utf-8');

describe('Report status vocabulary (frontend half)', () => {
  it('reports the same operational status the backend filters on', () => {
    // These five must agree with getAppointmentReportStatus() in
    // services/reportStatus.service.ts, or a row could be labelled COMPLETED
    // while being returned by the RESCHEDULED filter.
    expect(appointmentReportStatus({ status: 'CANCELLED', workStatus: 'COMPLETED' })).toBe('CANCELLED');
    expect(appointmentReportStatus({ status: 'RESCHEDULED', workStatus: 'COMPLETED' })).toBe('COMPLETED');
    expect(appointmentReportStatus({ status: 'SCHEDULED', workStatus: 'POSTPONED' })).toBe('POSTPONED');
    expect(appointmentReportStatus({ status: 'RESCHEDULED', workStatus: 'WAITING' })).toBe('RESCHEDULED');
    expect(appointmentReportStatus({ status: 'SCHEDULED', workStatus: 'WAITING' })).toBe('SCHEDULED');
  });

  it('treats an empty selection as "every status", matching the previous dropdown', () => {
    expect(statusParam([])).toBeUndefined();
    expect(statusParam(['COMPLETED', 'POSTPONED'])).toBe('COMPLETED,POSTPONED');
  });

  it('translates every status in both languages, with no raw enum value left', async () => {
    const ar = i18n.getFixedT('ar');
    const en = i18n.getFixedT('en');
    const expectedEn: Record<string, string> = {
      COMPLETED: 'Completed', POSTPONED: 'Postponed', RESCHEDULED: 'Rescheduled',
      SCHEDULED: 'Scheduled', PENDING: 'Pending', IN_PROGRESS: 'In Progress', CANCELLED: 'Cancelled',
    };
    const expectedAr: Record<string, string> = {
      COMPLETED: 'مكتمل', POSTPONED: 'مؤجل', RESCHEDULED: 'أعيدت جدولته',
      SCHEDULED: 'مجدول', PENDING: 'قيد الانتظار', IN_PROGRESS: 'قيد التنفيذ', CANCELLED: 'ملغي',
    };
    for (const status of APPOINTMENT_REPORT_STATUSES) {
      expect(appointmentStatusLabels(en as any)[status]).toBe(expectedEn[status]);
      expect(appointmentStatusLabels(ar as any)[status]).toBe(expectedAr[status]);
      // No language may fall through to the raw identifier.
      expect(appointmentStatusLabels(ar as any)[status]).not.toBe(status);
      expect(appointmentStatusLabels(en as any)[status]).not.toBe(status);
    }
    // And the row-level helper picks the right one from the same map.
    expect(appointmentStatusLabel({ status: 'RESCHEDULED', workStatus: 'COMPLETED' }, ar as any)).toBe('مكتمل');
    expect(appointmentStatusLabel({ status: 'RESCHEDULED', workStatus: 'WAITING' }, en as any)).toBe('Rescheduled');
  });
});

describe('Sales reports: the client-side cooldown is gone', () => {
  const src = source('admin/pages/Reports.tsx');

  it('no longer stores or reads a per-report timestamp in localStorage', () => {
    expect(src).not.toMatch(/wfm_sales_/);
    expect(src).not.toMatch(/setSalesLast|getSalesLast|salesRemaining/);
    expect(src).not.toMatch(/SALES_WEEK_MS|SALES_MONTH_MS/);
  });

  it('no longer renders a locked tile or a countdown', () => {
    expect(src).not.toMatch(/const locked = rem > 0/);
    expect(src).not.toMatch(/"متاح خلال"|"Available in"/);
    // The one-second interval existed only to animate that countdown.
    expect(src).not.toMatch(/setInterval\(\(\) => setTicker/);
  });

  it('leaves every sales tile generatable, gated only by a generation already in flight', () => {
    expect(src).toMatch(/onClick=\{\(\) => generateSalesReport\(period, format\)\}/);
    expect(src).toMatch(/disabled=\{generatingSales !== null\}/);
  });

  it('keeps the per-tile key that the removed lock disagreed with', () => {
    // The lock was read with `period` while tiles were keyed `period-format`, so
    // the weekly PDF and the weekly Excel shared one lock. The tile key stays;
    // there is simply no lock to mis-key any more.
    expect(src).toMatch(/const key = `\$\{period\}-\$\{format\}`;/);
    expect(src).toMatch(/const isGen = generatingSales === key;/);
  });
});

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

const APPTS = [
  { id: 'a1', status: 'SCHEDULED', workStatus: 'COMPLETED', type: 'MAINTENANCE', isUrgent: false,
    scheduledDate: '2026-06-15T09:00:00.000Z', createdByRole: 'ADMIN', customer: { id: 'c1', name: 'Ali', phone: '0500000001' } },
  { id: 'a2', status: 'SCHEDULED', workStatus: 'POSTPONED', type: 'MAINTENANCE', isUrgent: false,
    scheduledDate: '2026-06-16T09:00:00.000Z', createdByRole: 'ADMIN', customer: { id: 'c2', name: 'Sara', phone: '0500000002' } },
  { id: 'a3', status: 'RESCHEDULED', workStatus: 'WAITING', type: 'INSTALLATION', isUrgent: false,
    scheduledDate: '2026-06-17T09:00:00.000Z', createdByRole: 'SCHEDULING', customer: { id: 'c3', name: 'Noura', phone: '0500000003' } },
];

const apiGet = vi.fn((url: string, config: any = {}) => {
  if (url === '/appointments') {
    return Promise.resolve({ data: { success: true, data: APPTS, meta: { page: 1, limit: 100, total: APPTS.length, totalPages: 1 } } });
  }
  if (url === '/reports/customers') {
    return Promise.resolve({ data: { success: true, data: [], meta: { total: 0, page: 1, limit: 200, totalPages: 1 } } });
  }
  return Promise.resolve({ data: { success: true, data: [] } });
});

beforeEach(async () => {
  apiGet.mockClear();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => { useAppStore.setState({ adminAuth: null, serverUrl: 'http://localhost:9999' }); });
  await i18n.changeLanguage('ar');
});

async function mountReports() {
  vi.doMock('../../unified-app/src/admin/api/client', () => ({ api: { get: apiGet } }));
  const { default: Reports } = await import('../../unified-app/src/admin/pages/Reports');
  const el = mount(<Reports />);
  return el;
}

function clickText(el: HTMLElement, text: string) {
  // The report-type tiles nest a title and a description inside one button, so
  // an exact textContent match would never hit them.
  const btn = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes(text)) as HTMLButtonElement;
  if (!btn) throw new Error(`no button labelled ${JSON.stringify(text)}`);
  act(() => { btn.click(); });
  return btn;
}

describe('Appointment reports: multi-select status', () => {
  it('offers every operational status as a toggle, labelled in Arabic, not as a raw enum', async () => {
    const el = await mountReports();
    clickText(el, 'تقارير المواعيد');
    const group = el.querySelector('[role="group"]')!;
    const labels = Array.from(group.querySelectorAll('button')).map(b => b.textContent?.trim());
    expect(labels).toEqual(['مكتمل', 'مؤجل', 'أعيدت جدولته', 'مجدول', 'قيد الانتظار', 'قيد التنفيذ', 'ملغي']);
    // The seven raw identifiers the control used to display.
    for (const raw of ['COMPLETED', 'POSTPONED', 'RESCHEDULED', 'SCHEDULED', 'PENDING', 'CANCELLED']) {
      expect(group.textContent).not.toContain(raw);
    }
  });

  it('sends one, two and three selected statuses as a single validated parameter', async () => {
    const el = await mountReports();
    clickText(el, 'تقارير المواعيد');
    const group = el.querySelector('[role="group"]')!;
    const toggle = (label: string) => {
      const b = Array.from(group.querySelectorAll('button')).find(x => x.textContent?.trim() === label) as HTMLButtonElement;
      act(() => { b.click(); });
    };
    const load = () => clickText(el, 'تحميل النتائج');

    toggle('مكتمل');
    load();
    await waitFor(() => apiGet.mock.calls.some(c => c[0] === '/appointments'), { message: 'no appointment fetch' });
    let last = apiGet.mock.calls.filter(c => c[0] === '/appointments').pop()!;
    expect(last[1].params.reportStatus).toBe('COMPLETED');
    // The legacy single-value parameter is not sent alongside it.
    expect(last[1].params.status).toBeUndefined();

    toggle('مؤجل');
    await waitFor(
      () => apiGet.mock.calls.some(c => c[0] === '/appointments' && c[1]?.params?.reportStatus === 'COMPLETED,POSTPONED'),
      { message: 'two-status request never issued' }
    );

    toggle('أعيدت جدولته');
    await waitFor(
      () => apiGet.mock.calls.some(c => c[0] === '/appointments' && c[1]?.params?.reportStatus === 'COMPLETED,POSTPONED,RESCHEDULED'),
      { message: 'three-status request never issued' }
    );
  });

  it('omits the parameter entirely when nothing is selected, preserving "all"', async () => {
    const el = await mountReports();
    clickText(el, 'تقارير المواعيد');
    clickText(el, 'تحميل النتائج');
    await waitFor(() => apiGet.mock.calls.some(c => c[0] === '/appointments'), { message: 'no appointment fetch' });
    const call = apiGet.mock.calls.filter(c => c[0] === '/appointments').pop()!;
    expect(call[1].params.reportStatus).toBeUndefined();
    expect(el.textContent).toContain('لم يتم تحديد أي حالة');
  });

  it('renders localized statuses in the results table rather than raw enum values', async () => {
    const el = await mountReports();
    clickText(el, 'تقارير المواعيد');
    clickText(el, 'تحميل النتائج');
    await waitFor(() => (el.textContent || '').includes('Ali'), { message: 'appointment rows never rendered' });
    expect(el.textContent).toContain('مكتمل');
    expect(el.textContent).toContain('أعيدت جدولته');
    const tableText = Array.from(el.querySelectorAll('tbody')).map(b => b.textContent).join(' ');
    expect(tableText).not.toContain('RESCHEDULED');
    expect(tableText).not.toContain('COMPLETED');
  });

  it('gives the PDF and the Excel export the same localized status, from one mapping', async () => {
    const src = source('admin/pages/Reports.tsx');
    // Both builders call the shared helper, so there is no second mapping to
    // drift. This is asserted on the source because the exports themselves go
    // through Electron/ExcelJS, which is not what is being tested here.
    expect(src).toMatch(/<td>\$\{esc\(appointmentStatusLabel\(a, t\)\)\}<\/td>/);
    expect(src).toMatch(/"الحالة" : "Status"\]: appointmentStatusLabel\(a, t\)/);
    expect(src).not.toMatch(/\]: a\.status,/);
    expect(src).not.toMatch(/esc\(a\.status\)/);
    // ...and both read the SAME query result, so they cannot disagree about
    // which rows the selected statuses produced.
    expect(src).toMatch(/if \(!allAppts\.length\) return;\s*\n\s*setGeneratingAppts\("pdf"\)/);
    expect(src).toMatch(/if \(!allAppts\.length\) return;\s*\n\s*setGeneratingAppts\("excel"\)/);
  });
});

describe('Customer reports: multi-select status', () => {
  it('offers the customer vocabulary as toggles and sends several at once', async () => {
    const el = await mountReports();
    clickText(el, 'تقارير العملاء');
    const group = el.querySelector('[role="group"]')!;
    const labels = Array.from(group.querySelectorAll('button')).map(b => b.textContent?.trim());
    expect(labels).toContain('مكتملة');
    expect(labels).toContain('مؤجل');
    expect(labels).toContain('متأخرة');

    const toggle = (label: string) => {
      const b = Array.from(group.querySelectorAll('button')).find(x => x.textContent?.trim() === label) as HTMLButtonElement;
      act(() => { b.click(); });
    };
    toggle('مكتملة');
    toggle('مؤجل');
    clickText(el, 'تحميل النتائج');
    await waitFor(
      () => apiGet.mock.calls.some(c => c[0] === '/reports/customers' && c[1]?.params?.status === 'COMPLETED,POSTPONED'),
      { message: 'Completed + Postponed was never requested' }
    );
  });

  it('marks the selected toggles as pressed for assistive technology', async () => {
    const el = await mountReports();
    clickText(el, 'تقارير العملاء');
    const group = el.querySelector('[role="group"]')!;
    const btn = Array.from(group.querySelectorAll('button')).find(x => x.textContent?.trim() === 'مكتملة') as HTMLButtonElement;
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    act(() => { btn.click(); });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('fetches every matching page, so the headline count and the rows agree', async () => {
    const el = await mountReports();
    clickText(el, 'تقارير العملاء');
    clickText(el, 'تحميل النتائج');
    await waitFor(() => apiGet.mock.calls.some(c => c[0] === '/reports/customers'),
      { message: 'customer report was never fetched' });
    // fetchAllPages walks the endpoint's documented page size and its own
    // meta.totalPages. The old call asked for a flat limit=200 and then printed
    // meta.total as the report's headline figure, so a 900-customer filter
    // produced a PDF headed "900" containing 200 rows.
    const call = apiGet.mock.calls.filter(c => c[0] === '/reports/customers').pop()!;
    expect(call[1].params.page).toBe(1);
    expect(call[1].params.limit).toBe(100);
    const src = source('admin/pages/Reports.tsx');
    expect(src).not.toMatch(/limit: 200/);
    expect(src).toMatch(/const total = customers\.length;/);
  });

  it('names every selected status in the PDF header instead of just one', async () => {
    const src = source('admin/pages/Reports.tsx');
    expect(src).toMatch(/filters\.statuses\.map\(\(sv: CustomerReportStatus\) => customerStatusLabels\(t\)\[sv\]\)/);
    expect(src).not.toMatch(/filters\.status !== "ALL"/);
  });
});
