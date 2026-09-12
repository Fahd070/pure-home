// v4 Requirement #11: the Administration page formerly called "الفنيون".
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '../../unified-app/src/i18n';
import { useAppStore } from '../../unified-app/src/store/appStore';
import { waitFor } from './helpers/waitForCondition';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const TECHS = [
  {
    id: 't1', name: 'Khalid Al-Otaibi', email: 'khalid@wfm.local', role: 'TECHNICIAN',
    completedTasks: 137, postponedTasks: 12, noAnswerCount: 5,
    completedTasksList: [], postponedTasksList: [],
  },
  {
    id: 't2', name: 'Faisal Al-Harbi', email: 'faisal@wfm.local', role: 'TECHNICIAN',
    completedTasks: 4, postponedTasks: 0, noAnswerCount: 2,
    completedTasksList: [], postponedTasksList: [],
  },
];

const NO_ANSWER_ROWS = [
  {
    id: 'n1', note: 'phone switched off', createdAt: '2026-06-01T08:15:00.000Z',
    appointment: {
      id: 'a1', type: 'MAINTENANCE', scheduledDate: '2026-06-01T07:00:00.000Z',
      customer: { id: 'c1', name: 'Mona Store', phone: '0500000001' },
    },
  },
  {
    id: 'n2', note: null, createdAt: '2026-06-03T08:15:00.000Z',
    appointment: {
      id: 'a1', type: 'MAINTENANCE', scheduledDate: '2026-06-01T07:00:00.000Z',
      customer: { id: 'c1', name: 'Mona Store', phone: '0500000001' },
    },
  },
];

const POSTPONED_ROWS = [
  {
    id: 'p1', reason: 'customer travelling', createdAt: '2026-05-02T08:00:00.000Z',
    previousDate: '2026-05-10T09:00:00.000Z', newDate: '2026-06-20T09:00:00.000Z',
    appointment: {
      id: 'a2', type: 'MAINTENANCE', status: 'RESCHEDULED', workStatus: 'WAITING',
      scheduledDate: '2026-06-20T09:00:00.000Z',
      customer: { id: 'c2', name: 'Hani Cafe', phone: '0500000002' },
    },
  },
];

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
  if (url === '/technicians') return Promise.resolve({ data: { success: true, data: TECHS } });
  const m = url.match(/^\/technicians\/(\w+)\/activity$/);
  if (m) {
    const kind = config.params?.kind;
    const rows = kind === 'no-answer' ? NO_ANSWER_ROWS : kind === 'postponed' ? POSTPONED_ROWS : [];
    return Promise.resolve({
      data: {
        success: true, data: rows,
        meta: {
          total: rows.length, page: 1, limit: 20, totalPages: 1,
          technician: TECHS.find(t => t.id === m[1]),
        },
      },
    });
  }
  return Promise.resolve({ data: { success: true, data: [] } });
});

beforeEach(async () => {
  apiGet.mockClear();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => { useAppStore.setState({ adminAuth: null, serverUrl: 'http://localhost:9999' }); });
  await i18n.changeLanguage('ar');
});

async function mountPage() {
  vi.doMock('../../unified-app/src/admin/api/client', () => ({ api: { get: apiGet } }));
  const { default: Technicians } = await import('../../unified-app/src/admin/pages/Technicians');
  const el = mount(<Technicians />);
  await waitFor(() => (el.textContent || '').includes('Khalid Al-Otaibi'),
    { message: 'technician cards never rendered' });
  return el;
}

const findButton = (el: ParentNode, text: string) =>
  Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes(text)) as HTMLButtonElement;

describe('Technician Tasks — page identity', () => {
  it('is called مهام الفنيين in Arabic, in the page header and the navigation', () => {
    const ar = i18n.getFixedT('ar');
    expect(ar('technicians.title')).toBe('مهام الفنيين');
    expect(ar('nav.technicians')).toBe('مهام الفنيين');
  });

  it('is called Technician Tasks in English', () => {
    const en = i18n.getFixedT('en');
    expect(en('technicians.title')).toBe('Technician Tasks');
    expect(en('nav.technicians')).toBe('Technician Tasks');
  });

  it('leaves the technician ROLE and department names alone — this is a page label only', () => {
    const ar = i18n.getFixedT('ar');
    const en = i18n.getFixedT('en');
    expect(ar('dept.technician')).toBe('الفنيون');
    expect(en('dept.technician')).toBe('Technicians');
  });

  it('renders the renamed title on the page itself', async () => {
    const el = await mountPage();
    expect(el.textContent).toContain('مهام الفنيين');
  });
});

describe('Technician Tasks — summary cards', () => {
  it('names each technician individually, with their own three counters', async () => {
    const el = await mountPage();
    expect(el.textContent).toContain('Khalid Al-Otaibi');
    expect(el.textContent).toContain('Faisal Al-Harbi');

    const cards = Array.from(el.querySelectorAll('.grid > div'));
    const khalid = cards.find(c => c.textContent?.includes('Khalid Al-Otaibi'))!;
    const faisal = cards.find(c => c.textContent?.includes('Faisal Al-Harbi'))!;
    // The exact aggregate totals from the API -- not the length of a preview
    // list, which is what used to cap these at 20.
    expect(khalid.textContent).toContain('137');
    expect(khalid.textContent).toContain('12');
    expect(khalid.textContent).toContain('5');
    // One technician's numbers must never appear on another's card.
    expect(faisal.textContent).not.toContain('137');
    expect(faisal.textContent).toContain('4');
    expect(faisal.textContent).toContain('2');
  });

  it('adds the Customer Did Not Answer counter in both languages', async () => {
    let el = await mountPage();
    expect(el.textContent).toContain('العميل لم يرد');

    await i18n.changeLanguage('en');
    act(() => { root!.unmount(); });
    container!.remove();
    el = await mountPage();
    expect(el.textContent).toContain('Customer Did Not Answer');
  });

  it('disables a counter at zero instead of hiding it, so the three columns stay aligned', async () => {
    const el = await mountPage();
    const cards = Array.from(el.querySelectorAll('.grid > div'));
    const faisal = cards.find(c => c.textContent?.includes('Faisal Al-Harbi'))!;
    const counters = Array.from(faisal.querySelectorAll('button'));
    expect(counters).toHaveLength(3);
    const postponed = counters[1];
    expect(postponed.textContent).toContain('المهام المؤجلة');
    expect(postponed.disabled).toBe(true);
    expect(counters[0].disabled).toBe(false);
  });
});

describe('Technician Tasks — durable details', () => {
  it('fetches no-answer records from the durable endpoint for the right technician', async () => {
    const el = await mountPage();
    const cards = Array.from(el.querySelectorAll('.grid > div'));
    const khalid = cards.find(c => c.textContent?.includes('Khalid Al-Otaibi'))!;
    const noAnswerBtn = Array.from(khalid.querySelectorAll('button'))[2];
    act(() => { noAnswerBtn.click(); });

    await waitFor(
      () => apiGet.mock.calls.some(c => c[0] === '/technicians/t1/activity' && c[1]?.params?.kind === 'no-answer'),
      { message: 'no-answer activity was never requested' }
    );
    // Never the other technician's id.
    expect(apiGet.mock.calls.some(c => String(c[0]).includes('/technicians/t2/'))).toBe(false);

    await waitFor(() => (document.body.textContent || '').includes('Mona Store'),
      { message: 'no-answer rows never rendered' });
    const body = document.body.textContent || '';
    // Customer, appointment date, recorded timestamp, note and the technician.
    expect(body).toContain('Mona Store');
    expect(body).toContain('0500000001');
    expect(body).toContain('phone switched off');
    expect(body).toContain('وقت التسجيل');
    expect(body).toContain('Khalid Al-Otaibi');
    // Two attempts on one appointment are two rows, not one.
    expect(document.querySelectorAll('li').length).toBeGreaterThanOrEqual(2);
  });

  it('shows postponement history with the old and the new date', async () => {
    const el = await mountPage();
    const cards = Array.from(el.querySelectorAll('.grid > div'));
    const khalid = cards.find(c => c.textContent?.includes('Khalid Al-Otaibi'))!;
    act(() => { Array.from(khalid.querySelectorAll('button'))[1].click(); });

    await waitFor(
      () => apiGet.mock.calls.some(c => c[0] === '/technicians/t1/activity' && c[1]?.params?.kind === 'postponed'),
      { message: 'postponement activity was never requested' }
    );
    await waitFor(() => (document.body.textContent || '').includes('Hani Cafe'),
      { message: 'postponement rows never rendered' });
    const body = document.body.textContent || '';
    expect(body).toContain('customer travelling');
    expect(body).toContain('الموعد السابق');
    expect(body).toContain('الموعد الجديد');
    // The appointment has since been RESCHEDULED back to WAITING, and it is still
    // in the postponement history -- which is the whole point of reading the
    // durable record rather than the appointment's current state.
    expect(body).toContain('10/05/2026');
    expect(body).toContain('20/06/2026');
  });

  it('fetches the completion photo only for the row actually opened', async () => {
    // The activity list select deliberately omits completionImage; the detail
    // view asks the appointment endpoint for the one record it is about.
    const el = await mountPage();
    const cards = Array.from(el.querySelectorAll('.grid > div'));
    const khalid = cards.find(c => c.textContent?.includes('Khalid Al-Otaibi'))!;
    act(() => { Array.from(khalid.querySelectorAll('button'))[0].click(); });
    await waitFor(
      () => apiGet.mock.calls.some(c => c[0] === '/technicians/t1/activity' && c[1]?.params?.kind === 'completed'),
      { message: 'completed activity was never requested' }
    );
    // Opening the LIST must not have fetched any appointment detail yet.
    expect(apiGet.mock.calls.some(c => String(c[0]).startsWith('/appointments/'))).toBe(false);
  });

  it('does not preload every technician’s details just to show three numbers', async () => {
    await mountPage();
    // Only the roster is fetched on mount.
    const calls = apiGet.mock.calls.map(c => c[0]);
    expect(calls).toContain('/technicians');
    expect(calls.some(u => String(u).includes('/activity'))).toBe(false);
  });
});
