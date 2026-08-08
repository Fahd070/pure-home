// Regression tests for the department-selection screen simplification: the
// three department cards (admin/scheduling/technician) no longer render an
// icon, keeping only the Arabic/English names, while preserving click
// behavior, labels, and layout otherwise. No React Testing Library is
// installed in this project, so these render with plain react-dom/client +
// act, matching the pattern used by routing.test.tsx / rowActionButton.test.tsx.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import '../../unified-app/src/i18n';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('axios', () => ({
  default: { get: vi.fn(() => Promise.reject(new Error('no network in tests'))) },
}));

// react-router-dom is aliased (vitest.config.ts) to unified-app's own copy,
// so this import and DepartmentSelector's internal import resolve to the
// exact same module -- required for a real <MemoryRouter> here to satisfy
// DepartmentSelector's useNavigate() call (see vitest.config.ts comment).
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) { act(() => { root!.unmount(); }); root = null; }
  if (container) { container.remove(); container = null; }
  mockNavigate.mockClear();
});

async function renderDepartmentSelector() {
  const { default: DepartmentSelector } = await import('../../unified-app/src/pages/DepartmentSelector');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter>
        <DepartmentSelector />
      </MemoryRouter>
    );
  });
  return container;
}

describe('DepartmentSelector', () => {
  it('renders all three department cards (Administration, Scheduling & Maintenance, Technicians)', async () => {
    const el = await renderDepartmentSelector();
    const buttons = el.querySelectorAll('button');
    // 3 department cards + language toggle + server-setup button = 5 buttons total.
    const deptButtons = Array.from(buttons).filter(b =>
      b.textContent?.includes('Administration') ||
      b.textContent?.includes('Scheduling & Maintenance') ||
      b.textContent?.includes('Technicians')
    );
    expect(deptButtons.length).toBe(3);
  });

  it('keeps the existing Arabic and English department labels unchanged', async () => {
    const el = await renderDepartmentSelector();
    const text = el.textContent || '';
    expect(text).toContain('الإدارة');
    expect(text).toContain('Administration');
    expect(text).toContain('الجدولة والصيانة');
    expect(text).toContain('Scheduling & Maintenance');
    expect(text).toContain('الفنيون');
    expect(text).toContain('Technicians');
  });

  it('no longer renders the department icons (⊞ / 📅 / 🔧) and each card has exactly two text labels, no icon wrapper', async () => {
    const el = await renderDepartmentSelector();
    const text = el.textContent || '';
    expect(text).not.toContain('⊞');
    expect(text).not.toContain('🔧');
    // 📅 also appears nowhere now that the department icon using it was removed
    // (no other element on this screen uses a calendar glyph).
    expect(text).not.toContain('📅');

    const buttons = Array.from(el.querySelectorAll('button'));
    const deptButtons = buttons.filter(b =>
      b.textContent?.includes('Administration') ||
      b.textContent?.includes('Scheduling & Maintenance') ||
      b.textContent?.includes('Technicians')
    );
    for (const btn of deptButtons) {
      // Exactly the two label <span> elements remain -- no icon <div> wrapper.
      expect(btn.querySelectorAll('span').length).toBe(2);
      expect(btn.querySelectorAll('div').length).toBe(0);
    }
  });

  it('clicking the Administration card navigates to /code-entry/admin (unchanged click behavior)', async () => {
    const el = await renderDepartmentSelector();
    const btn = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes('Administration'))!;
    act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(mockNavigate).toHaveBeenCalledWith('/code-entry/admin');
  });

  it('clicking the Scheduling & Maintenance card navigates to /code-entry/scheduling (unchanged click behavior)', async () => {
    const el = await renderDepartmentSelector();
    const btn = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes('Scheduling & Maintenance'))!;
    act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(mockNavigate).toHaveBeenCalledWith('/code-entry/scheduling');
  });

  it('clicking the Technicians card navigates to /code-entry/technician (unchanged click behavior)', async () => {
    const el = await renderDepartmentSelector();
    const btn = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes('Technicians'))!;
    act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(mockNavigate).toHaveBeenCalledWith('/code-entry/technician');
  });
});
