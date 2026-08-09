// Department selector focus/selection text readability fix: hovering or
// keyboard-focusing a department card now fills it with a SOLID department
// color (instead of a faint ~9% tint) and switches the label text to white --
// matching how each department's own color is already used as a solid
// background paired with white text everywhere else in the app (sidebars,
// headers). Real-rendered with plain react-dom/client + act, matching this
// project's established pattern for DepartmentSelector (see
// departmentSelector.test.tsx). Keyboard focus is used as the reliable
// real-render trigger for the shared `active` state (hover and focus both
// set the same boolean); hover itself and native Enter/Space activation are
// confirmed at the source level, since jsdom does not reliably synthesize
// React's mouseenter/mouseleave delegation or native button keyboard
// activation the way a real browser does.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'fs';
import path from 'path';
import '../../unified-app/src/i18n';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('axios', () => ({
  default: { get: vi.fn(() => Promise.reject(new Error('no network in tests'))) },
}));

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

function deptButtons(el: HTMLElement) {
  return Array.from(el.querySelectorAll('button')).filter(b =>
    b.textContent?.includes('Administration') ||
    b.textContent?.includes('Scheduling & Maintenance') ||
    b.textContent?.includes('Technicians')
  );
}

function labelSpans(btn: HTMLButtonElement) {
  return Array.from(btn.querySelectorAll('span'));
}

describe('Department card focus/selection text readability', () => {
  // 1. Normal state retains existing (dark) text color.
  it('a department card in its normal (unfocused) state keeps the existing dark label colors', async () => {
    const el = await renderDepartmentSelector();
    const btn = deptButtons(el)[0] as HTMLButtonElement;
    const [primary, secondary] = labelSpans(btn);
    expect(primary.className).toContain('text-slate-800');
    expect(secondary.className).toContain('text-slate-400');
    expect(primary.className).not.toContain('text-white');
  });

  // 2, 3. Keyboard-focused card text becomes white/readable (also stands in for
  // "selected", since this component has no separate persisted selection state
  // beyond hover/focus -- clicking navigates away immediately).
  it('focusing a card (keyboard Tab) turns its label text white', async () => {
    const el = await renderDepartmentSelector();
    const btn = deptButtons(el)[0] as HTMLButtonElement;
    act(() => { btn.dispatchEvent(new FocusEvent('focus', { bubbles: true })); btn.focus(); });
    const [primary, secondary] = labelSpans(btn);
    expect(primary.className).toContain('text-white');
    expect(secondary.className).toContain('text-white/80');
    expect(primary.className).not.toContain('text-slate-800');
  });

  // 4. focus-visible indicator remains present (accessible keyboard outline).
  it('the focus-visible ring utility classes are present (not suppressed)', async () => {
    const el = await renderDepartmentSelector();
    const btn = deptButtons(el)[0] as HTMLButtonElement;
    expect(btn.className).toContain('focus-visible:ring-2');
    expect(btn.className).toContain('focus-visible:ring-white');
    expect(btn.className).not.toContain('outline-none');
  });

  // 5. Switching focus away restores the previous card's normal colors, and
  // the newly-focused card becomes active -- each card tracks its own state
  // independently, so this happens automatically via blur/focus.
  it('blurring a focused card restores its normal colors; focusing a different card activates that one instead', async () => {
    const el = await renderDepartmentSelector();
    const [first, second] = deptButtons(el) as HTMLButtonElement[];

    act(() => { first.focus(); });
    expect(labelSpans(first)[0].className).toContain('text-white');

    act(() => { first.blur(); second.focus(); });
    expect(labelSpans(first)[0].className).not.toContain('text-white');
    expect(labelSpans(first)[0].className).toContain('text-slate-800');
    expect(labelSpans(second)[0].className).toContain('text-white');
  });

  // 6, 7. Arabic and English labels both remain present and readable (white)
  // while a card is active, in both label positions (primary/secondary swap
  // by language, but both still exist and both still turn white).
  it('both the Arabic and English label spans turn white together while a card is active', async () => {
    const el = await renderDepartmentSelector();
    const btn = deptButtons(el)[0] as HTMLButtonElement;
    act(() => { btn.focus(); });
    const [primary, secondary] = labelSpans(btn);
    expect(primary.textContent).toBeTruthy();
    expect(secondary.textContent).toBeTruthy();
    expect(primary.className).toContain('text-white');
    expect(secondary.className).toContain('text-white/80');
  });

  // 8. Modification #2's no-icon behavior is unaffected by this change.
  it('cards still render no icon wrapper -- exactly two label spans, no divs', async () => {
    const el = await renderDepartmentSelector();
    for (const btn of deptButtons(el)) {
      expect(btn.querySelectorAll('span').length).toBe(2);
      expect(btn.querySelectorAll('div').length).toBe(0);
    }
  });

  it('clicking still navigates (unchanged click behavior, unaffected by the focus/color fix)', async () => {
    const el = await renderDepartmentSelector();
    const btn = deptButtons(el).find(b => b.textContent?.includes('Technicians'))!;
    act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(mockNavigate).toHaveBeenCalledWith('/code-entry/technician');
  });
});

describe('Department card: source-level confirmation of hover/keyboard-activation wiring', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/pages/DepartmentSelector.tsx'), 'utf-8');

  // 2 (hover half). jsdom does not reliably synthesize React's mouseenter/
  // mouseleave delegation, so hover is confirmed here: it sets the exact same
  // `hovered` state that drives the same `active`-derived white-text className.
  it('onMouseEnter/onMouseLeave drive the same "active" state as keyboard focus', () => {
    expect(src).toMatch(/onMouseEnter=\{\(\) => setHovered\(true\)\}/);
    expect(src).toMatch(/onMouseLeave=\{\(\) => setHovered\(false\)\}/);
    expect(src).toMatch(/const active = hovered \|\| focused;/);
  });

  // 9. Enter/Space activation is native <button> behavior in any real browser
  // -- confirmed here by the element still being a real <button> with only an
  // onClick handler (no onKeyDown/preventDefault that could suppress it).
  it('department cards remain native <button> elements with no keyboard handler that could block default Enter/Space activation', () => {
    expect(src).toMatch(/<button\s*\n\s*onClick=\{onClick\}/);
    expect(src).not.toMatch(/onKeyDown/);
    expect(src).not.toMatch(/preventDefault/);
  });

  it('the active fill uses the department\'s own solid color (not a faint tint), matching the same color\'s use elsewhere in the app', () => {
    expect(src).toMatch(/backgroundColor:\s*active \? color : "#ffffff"/);
    expect(src).not.toMatch(/color \+ "18"/);
  });
});
