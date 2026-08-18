// Regression tests for UpdateBanner: (1) the "ready" install button must not
// stay hidden for the rest of the session just because an earlier
// available/error banner was dismissed (autoInstallOnAppQuit is false, so
// this button is the ONLY way to install), and (2) the banner copy must not
// promise behavior the app doesn't actually have (an automatic retry after a
// failed check, or an install-on-restart that no longer happens since
// autoInstallOnAppQuit was turned off).
//
// No React Testing Library is installed in this project; this renders with
// plain react-dom/client + act, matching appTitleBar.test.tsx.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import fs from 'fs';
import path from 'path';
import i18n from '../../unified-app/src/i18n'; // ensures react-i18next has an initialized instance before render
import UpdateBanner from '../../unified-app/src/components/UpdateBanner';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type Handlers = {
  available?: (info: { version: string }) => void;
  progress?: (data: { percent: number }) => void;
  downloaded?: (info: { version: string }) => void;
  error?: (data: { message: string }) => void;
};

function makeUpdaterMock() {
  const handlers: Handlers = {};
  return {
    handlers,
    onAvailable: (cb: Handlers['available']) => { handlers.available = cb; return () => { handlers.available = undefined; }; },
    onProgress: (cb: Handlers['progress']) => { handlers.progress = cb; return () => { handlers.progress = undefined; }; },
    onDownloaded: (cb: Handlers['downloaded']) => { handlers.downloaded = cb; return () => { handlers.downloaded = undefined; }; },
    onError: (cb: Handlers['error']) => { handlers.error = cb; return () => { handlers.error = undefined; }; },
    download: vi.fn(),
    install: vi.fn(),
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let updater: ReturnType<typeof makeUpdaterMock>;

beforeEach(() => {
  updater = makeUpdaterMock();
  (window as any).electron = { updater };
  // Default app language is Arabic (i18n.ts: fallbackLng/lng: "ar"). Force
  // English so these assertions are deterministic regardless of that default.
  i18n.changeLanguage('en');
});

afterEach(() => {
  if (root) { act(() => { root!.unmount(); }); root = null; }
  if (container) { container.remove(); container = null; }
  delete (window as any).electron;
  i18n.changeLanguage('ar');
});

function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(<UpdateBanner />); });
  return container;
}

function findButtonByText(el: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(el.querySelectorAll('button')).find((b) => (b.textContent || '').includes(text)) as
    | HTMLButtonElement
    | undefined;
}

describe('UpdateBanner: dismissing an earlier banner must not hide the ready/install banner', () => {
  it('available -> user dismisses -> downloaded (ready) still shows, with the Restart & Update button visible', () => {
    const el = render();

    act(() => updater.handlers.available?.({ version: '3.7.0' }));
    expect(el.textContent).toMatch(/3\.7\.0/);

    const dismissBtn = el.querySelector('button[aria-label="Dismiss"]') as HTMLButtonElement;
    expect(dismissBtn).toBeTruthy();
    act(() => { dismissBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(el.textContent).toBe(''); // dismissed -> nothing rendered

    act(() => updater.handlers.downloaded?.({ version: '3.7.0' }));

    // Must be visible again despite the earlier dismissal.
    expect(el.textContent).not.toBe('');
    const installBtn = findButtonByText(el, 'Restart & Update');
    expect(installBtn).toBeTruthy();

    act(() => { installBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(updater.install).toHaveBeenCalledTimes(1);
  });

  it('error -> user dismisses -> downloaded (ready) still shows the install button', () => {
    const el = render();

    act(() => updater.handlers.error?.({ message: 'network unreachable' }));
    const dismissBtn = el.querySelector('button[aria-label="Dismiss"]') as HTMLButtonElement;
    act(() => { dismissBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(el.textContent).toBe('');

    act(() => updater.handlers.downloaded?.({ version: '4.0.0' }));
    expect(findButtonByText(el, 'Restart & Update')).toBeTruthy();
  });

  it('dismissing the ready banner itself is still respected (no forced re-show)', () => {
    const el = render();
    act(() => updater.handlers.downloaded?.({ version: '3.7.0' }));
    const dismissBtn = el.querySelector('button[aria-label="Dismiss"]');
    expect(dismissBtn).toBeFalsy(); // ready phase has no dismiss button, only Install
    // Nothing to dismiss on "ready" itself here since there's no repeat
    // update-downloaded event in a real session to worry about re-hiding.
    expect(findButtonByText(el, 'Restart & Update')).toBeTruthy();
  });
});

describe('UpdateBanner: copy accuracy', () => {
  it('the error banner does not promise an automatic retry', () => {
    const el = render();
    act(() => updater.handlers.error?.({ message: 'boom' }));
    expect(el.textContent).not.toMatch(/retry automatically/i);
    expect(el.textContent).not.toMatch(/سيتم المحاولة مرة أخرى تلقائيًا/);
    expect(el.textContent).toMatch(/next time the app starts/i);
  });

  it('the ready banner does not claim install happens automatically on restart', () => {
    const el = render();
    act(() => updater.handlers.downloaded?.({ version: '3.7.0' }));
    expect(el.textContent).not.toMatch(/will install on restart/i);
    expect(el.textContent).not.toMatch(/سيتم التثبيت عند إعادة التشغيل/);
    expect(el.textContent).toMatch(/Restart & Update/);
  });
});

// Source-level guard, matching this project's established pattern (see
// appTitleBar.test.tsx) of locking in a fix against silent regressions.
describe('UpdateBanner source: no stale copy, and dismissed state is reset on reaching "ready"', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../unified-app/src/components/UpdateBanner.tsx'),
    'utf-8'
  );

  it('does not contain the old inaccurate English or Arabic strings', () => {
    expect(src).not.toMatch(/will retry automatically/i);
    expect(src).not.toMatch(/سيتم المحاولة مرة أخرى تلقائيًا/);
    expect(src).not.toMatch(/will install on restart/i);
    expect(src).not.toMatch(/سيتم التثبيت عند إعادة التشغيل/);
  });

  it('resets dismissed state specifically when the phase becomes "ready"', () => {
    expect(src).toMatch(/if\s*\(\s*state\.phase\s*===\s*"ready"\s*\)\s*setDismissed\(false\)/);
  });
});
