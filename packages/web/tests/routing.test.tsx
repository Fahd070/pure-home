// Regression tests for audit finding F-7 (react-router / react-router-dom
// open-redirect advisories, fixed by upgrading 6.21.3 -> 7.18.2). No React
// Testing Library is installed, so these render with plain react-dom/client +
// act -- the smallest dependency-free way to prove the actual route/guard/
// redirect/nested-Outlet pattern used throughout App.tsx still behaves
// identically under v7's library (declarative) mode, which is the same mode
// used everywhere in this app (no data routers, no loaders/actions).
import { describe, it, expect, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Routes, Route, Navigate, Outlet, Link } from 'react-router-dom';
import fs from 'fs';
import path from 'path';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function Guard({ authed, children }: { authed: boolean; children: React.ReactNode }) {
  if (!authed) return <Navigate to="/code-entry/admin" replace />;
  return <>{children}</>;
}
function Layout() {
  return (
    <div>
      <Link to="/admin/dashboard" data-testid="dash-link">Dashboard link</Link>
      <Outlet />
    </div>
  );
}
function Dashboard() { return <div data-testid="dashboard">Dashboard content</div>; }
function CodeEntry() { return <div data-testid="code-entry">Code entry page</div>; }
function Home() { return <div data-testid="home">Home page</div>; }

// Mirrors the exact structural pattern App.tsx uses for all three department
// route trees: a guard wrapping a layout route, an index route that redirects
// to the department's landing page, a nested content route rendered via
// <Outlet>, a dedicated code-entry route, and a catch-all "*" -> "/" redirect.
function TestApp({ authed, initialPath }: { authed: boolean; initialPath: string }) {
  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/code-entry/:dept" element={<CodeEntry />} />
        <Route path="/admin" element={<Guard authed={authed}><Layout /></Guard>}>
          <Route index element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MemoryRouter>
  );
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function renderApp(authed: boolean, initialPath: string) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(<TestApp authed={authed} initialPath={initialPath} />); });
  return container;
}

afterEach(() => {
  if (root) { act(() => root!.unmount()); root = null; }
  if (container) { container.remove(); container = null; }
});

describe('routing (F-7 react-router-dom v7 regression)', () => {
  it('unauthenticated access to a guarded route (ADMIN) redirects to its code-entry page', () => {
    const el = renderApp(false, '/admin/dashboard');
    expect(el.querySelector('[data-testid="code-entry"]')?.textContent).toBe('Code entry page');
  });

  it('authenticated access to a guarded index route redirects to its landing page, rendering the nested Outlet content', () => {
    const el = renderApp(true, '/admin');
    expect(el.querySelector('[data-testid="dashboard"]')?.textContent).toBe('Dashboard content');
    // The parent Layout (with its internal <Link>) is still rendered around the Outlet.
    expect(el.querySelector('[data-testid="dash-link"]')).not.toBeNull();
  });

  it('an unknown/unauthorized route redirects to home via the catch-all "*" route', () => {
    const el = renderApp(true, '/this/route/does/not/exist');
    expect(el.querySelector('[data-testid="home"]')?.textContent).toBe('Home page');
  });

  it('an internal Link renders a relative internal href, not an absolute/external URL', () => {
    const el = renderApp(true, '/admin/dashboard');
    const link = el.querySelector('[data-testid="dash-link"]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/admin/dashboard');
  });
});

describe('no external-URL navigation exists in active routing source (F-7 open-redirect guard)', () => {
  // Matches navigate("http://..."), navigate(`https://${...`, <Navigate to="http://...">,
  // or a <Link>/<NavLink> to="http(s)://..." -- any externally-schemed target passed to
  // react-router navigation, which is the actual class of bug F-7's advisories are about.
  const externalUrlPattern = /(?:navigate|to)\s*[:(=]\s*[{]?\s*[`'"]https?:\/\//;
  const files = [
    '../../unified-app/src/App.tsx',
    '../../unified-app/src/pages/CodeEntry.tsx',
    '../../unified-app/src/pages/DepartmentSelector.tsx',
    '../../unified-app/src/pages/ServerSetup.tsx',
    '../../unified-app/src/admin/pages/Customers.tsx',
    '../../unified-app/src/admin/pages/CustomerDetail.tsx',
    '../../unified-app/src/admin/components/Sidebar.tsx',
    '../../unified-app/src/scheduling/pages/Appointments.tsx',
    '../../unified-app/src/scheduling/components/Sidebar.tsx',
    '../../unified-app/src/technician/pages/WorkQueue.tsx',
    '../../unified-app/src/technician/components/Sidebar.tsx',
  ];

  for (const rel of files) {
    it(`${rel} never passes an external URL to react-router navigation`, () => {
      const source = fs.readFileSync(path.resolve(__dirname, rel), 'utf-8');
      expect(source).not.toMatch(externalUrlPattern);
    });
  }
});
