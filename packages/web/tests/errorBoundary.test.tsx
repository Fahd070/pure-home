// Regression tests for the top-level render-failure guard (audit finding: no
// ErrorBoundary anywhere meant any uncaught render exception blanked the
// whole app). No React Testing Library is installed in this project, so this
// renders with plain react-dom/client + act, matching the pattern used by
// appTitleBar.test.tsx / departmentSelector.test.tsx.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import ErrorBoundary from '../../unified-app/src/components/ErrorBoundary';
import fs from 'fs';
import path from 'path';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // React itself also logs the caught error to console.error -- spy on it so
  // the expected diagnostic log doesn't show up as noisy test output, and so
  // we can assert our own boundary logged something too.
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  if (root) { act(() => { root!.unmount(); }); root = null; }
  if (container) { container.remove(); container = null; }
  consoleErrorSpy.mockRestore();
});

function Bomb(): React.ReactElement {
  throw new Error('boom: simulated render failure with a fake C:\\Users\\someone\\secret\\path and a token=abc123');
}

function Safe() {
  return <div data-testid="safe-child">All good</div>;
}

function render(child: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<ErrorBoundary>{child}</ErrorBoundary>);
  });
  return container;
}

describe('ErrorBoundary', () => {
  it('renders children normally when nothing throws', () => {
    const el = render(<Safe />);
    expect(el.textContent).toContain('All good');
  });

  it('catches a render exception and shows a fallback instead of a blank screen', () => {
    const el = render(<Bomb />);
    expect(el.children.length).toBeGreaterThan(0);
    expect(el.textContent).not.toBe('');
    expect(el.textContent?.toLowerCase()).toMatch(/wrong|error|خطأ/i);
  });

  it('offers a reload action in the fallback UI', () => {
    const el = render(<Bomb />);
    const reloadBtn = Array.from(el.querySelectorAll('button')).find((b) =>
      /reload|إعادة/i.test(b.textContent || '')
    );
    expect(reloadBtn).toBeTruthy();
  });

  it('never renders the raw error message, file paths, or tokens into the fallback UI', () => {
    const el = render(<Bomb />);
    expect(el.innerHTML).not.toMatch(/boom: simulated render failure/);
    expect(el.innerHTML).not.toMatch(/C:\\Users/);
    expect(el.innerHTML).not.toMatch(/token=abc123/);
  });

  it('logs diagnostics locally via console.error (developer-only, never shown to the user)', () => {
    render(<Bomb />);
    const loggedToOurBoundary = consoleErrorSpy.mock.calls.some((args) =>
      String(args[0]).includes('[ErrorBoundary]')
    );
    expect(loggedToOurBoundary).toBe(true);
  });
});

// Source-level guard: confirm the app's root actually wraps in this boundary,
// so a future refactor of App.tsx can't silently drop it.
describe('App.tsx wires the ErrorBoundary around the routed application root', () => {
  const appSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/App.tsx'), 'utf-8');

  it('imports ErrorBoundary and wraps the router in it', () => {
    expect(appSrc).toMatch(/import ErrorBoundary from ["']\.\/components\/ErrorBoundary["']/);
    expect(appSrc).toMatch(/<ErrorBoundary>\s*<HashRouter>/);
  });
});
