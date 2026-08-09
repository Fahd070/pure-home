// Regression tests for Modification #7: the read-only "Previous Maintenance Note"
// box shown when Admin/Scheduling schedules a new appointment for an existing
// customer, reusing Modification #6's Appointment.nextMaintenanceNote field.
//
// PreviousMaintenanceNoteBox itself is pure/presentational (no data fetching), so
// it renders directly with react-dom/client + act, matching this project's
// established pattern (see rowActionButton.test.tsx). The stale-response-safety
// property (tests 8-10 in the modification spec) is proven with a small harness
// that mirrors the exact pattern used in the real forms -- useQuery keyed on
// customerId + this same box -- rather than asserting it by inspection, since
// that's the one behavior worth verifying concretely rather than trusting by
// convention. The five real call sites are then checked at the source level
// (same convention as appointmentExport.test.ts / nextMaintenanceNote.test.ts)
// for wiring correctness, since fully rendering them requires each department's
// own router/api-client/provider stack for no additional signal.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import fs from 'fs';
import path from 'path';
import i18n from '../../unified-app/src/i18n';
import PreviousMaintenanceNoteBox from '../../unified-app/src/components/PreviousMaintenanceNoteBox';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) { act(() => { root!.unmount(); }); root = null; }
  if (container) { container.remove(); container = null; }
});

function render(ui: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(ui); });
  return container;
}

// Lets pending microtasks (promise resolution) AND react-query's internal
// scheduling (which defers its state update by a macrotask) flush and re-render
// before the next assertion.
function flush() {
  return act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

describe('PreviousMaintenanceNoteBox (presentational)', () => {
  it('renders nothing when note is null', () => {
    const el = render(<PreviousMaintenanceNoteBox note={null} />);
    expect(el.textContent).toBe('');
  });

  it('renders nothing when note is undefined (still loading / no customer selected)', () => {
    const el = render(<PreviousMaintenanceNoteBox note={undefined} />);
    expect(el.textContent).toBe('');
  });

  it('renders nothing when note is an empty string', () => {
    const el = render(<PreviousMaintenanceNoteBox note="" />);
    expect(el.textContent).toBe('');
  });

  it('renders the label and note text when a note is present', () => {
    const el = render(<PreviousMaintenanceNoteBox note="Check filter" />);
    expect(el.textContent).toContain(i18n.t('appointments.previousMaintenanceNote'));
    expect(i18n.t('appointments.previousMaintenanceNote')).toBe('ملاحظة الصيانة السابقة');
    expect(el.textContent).toContain('Check filter');
  });

  it('is read-only: no input/textarea/button/editable element is rendered', () => {
    const el = render(<PreviousMaintenanceNoteBox note="Check filter" />);
    expect(el.querySelector('input')).toBeNull();
    expect(el.querySelector('textarea')).toBeNull();
    expect(el.querySelector('button')).toBeNull();
    expect(el.querySelector('[contenteditable]')).toBeNull();
  });
});

describe('Previous Maintenance Note: stale-response race safety (react-query cache-key identity)', () => {
  // Deferred promises per customer id, so the test controls exactly when each
  // "network response" resolves, independent of call order.
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
  }

  function Harness({ customerId, fetchNote }: { customerId: string | null; fetchNote: (id: string) => Promise<string | null> }) {
    const { data } = useQuery({
      queryKey: ['latest-maintenance-note', customerId],
      queryFn: () => fetchNote(customerId as string),
      enabled: !!customerId,
    });
    return <PreviousMaintenanceNoteBox note={data as string | null | undefined} />;
  }

  function renderHarness(qc: QueryClient, customerId: string | null, fetchNote: any) {
    return render(
      <QueryClientProvider client={qc}>
        <Harness customerId={customerId} fetchNote={fetchNote} />
      </QueryClientProvider>
    );
  }

  it('switching customer A -> B clears A\'s note (and does not show a stale one) even before B resolves', async () => {
    const qc = new QueryClient();
    const a = deferred<string | null>();
    const fetchNote = vi.fn((id: string) => (id === 'A' ? a.promise : new Promise(() => {})));

    renderHarness(qc, 'A', fetchNote);
    a.resolve('Check filter');
    await flush();
    expect(container!.textContent).toContain('Check filter');

    // Switch to B, whose fetch never resolves in this test -- box must clear immediately.
    act(() => { root!.render(<QueryClientProvider client={qc}><Harness customerId="B" fetchNote={fetchNote} /></QueryClientProvider>); });
    expect(container!.textContent).not.toContain('Check filter');
  });

  it('switching A -> B -> C displays only C\'s current note', async () => {
    const qc = new QueryClient();
    const notes: Record<string, string> = { A: 'A note', B: 'B note', C: 'C note' };
    const fetchNote = vi.fn(async (id: string) => notes[id]);

    renderHarness(qc, 'A', fetchNote);
    await flush();

    act(() => { root!.render(<QueryClientProvider client={qc}><Harness customerId="B" fetchNote={fetchNote} /></QueryClientProvider>); });
    await flush();

    act(() => { root!.render(<QueryClientProvider client={qc}><Harness customerId="C" fetchNote={fetchNote} /></QueryClientProvider>); });
    await flush();

    expect(container!.textContent).toContain('C note');
    expect(container!.textContent).not.toContain('A note');
    expect(container!.textContent).not.toContain('B note');
  });

  it('a stale, late-arriving response for A cannot overwrite B\'s displayed note', async () => {
    const qc = new QueryClient();
    const a = deferred<string | null>();
    const b = deferred<string | null>();
    const fetchNote = vi.fn((id: string) => (id === 'A' ? a.promise : b.promise));

    renderHarness(qc, 'A', fetchNote);
    // Switch to B before A resolves.
    act(() => { root!.render(<QueryClientProvider client={qc}><Harness customerId="B" fetchNote={fetchNote} /></QueryClientProvider>); });
    // B resolves first.
    b.resolve('B note');
    await flush();
    expect(container!.textContent).toContain('B note');

    // A's stale response finally arrives, late, for a customer no longer selected.
    a.resolve('A note (stale)');
    await flush();
    expect(container!.textContent).toContain('B note');
    expect(container!.textContent).not.toContain('A note (stale)');
  });

  it('a failed note lookup does not crash and does not display a previous customer\'s note', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetchNote = vi.fn((id: string) => (id === 'A' ? Promise.resolve('A note') : Promise.reject(new Error('network error'))));

    renderHarness(qc, 'A', fetchNote);
    await flush();
    expect(container!.textContent).toContain('A note');

    act(() => { root!.render(<QueryClientProvider client={qc}><Harness customerId="B" fetchNote={fetchNote} /></QueryClientProvider>); });
    await flush();

    expect(container!.textContent).not.toContain('A note');
    expect(() => container!.textContent).not.toThrow();
  });
});

describe('All five appointment-creation forms wire in the Previous Maintenance Note box', () => {
  const files = {
    adminAppointments: fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/admin/pages/Appointments.tsx'), 'utf-8'),
    adminDashboard: fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/admin/pages/Dashboard.tsx'), 'utf-8'),
    schedNewAppointment: fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/scheduling/pages/NewAppointment.tsx'), 'utf-8'),
    schedDashboard: fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/scheduling/pages/Dashboard.tsx'), 'utf-8'),
    schedCustomerList: fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/scheduling/pages/CustomerList.tsx'), 'utf-8'),
  };

  it.each(Object.entries(files))('%s imports and renders PreviousMaintenanceNoteBox, queried by customer id', (_name, src) => {
    expect(src).toMatch(/import PreviousMaintenanceNoteBox from ["']\.\.\/\.\.\/components\/PreviousMaintenanceNoteBox["']/);
    expect(src).toMatch(/<PreviousMaintenanceNoteBox note=\{prevNote\}\s*\/>/);
    expect(src).toMatch(/queryKey:\s*\["latest-maintenance-note",/);
    expect(src).toMatch(/\/latest-maintenance-note`\)/);
  });

  it('does not pass an onChange/editable handler into PreviousMaintenanceNoteBox anywhere (stays read-only)', () => {
    for (const src of Object.values(files)) {
      expect(src).not.toMatch(/<PreviousMaintenanceNoteBox[^>]*onChange/);
    }
  });
});
