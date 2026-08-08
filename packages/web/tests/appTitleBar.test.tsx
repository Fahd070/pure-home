// Regression tests for the Electron desktop title-bar window controls
// (minimize/maximize-restore/close): larger, clearer icon buttons replacing
// tiny (20px) text-glyph buttons, with unchanged click behavior and no new
// IPC surface. No React Testing Library is installed in this project, so
// these render with plain react-dom/client + act, matching the pattern used
// by rowActionButton.test.tsx / departmentSelector.test.tsx.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'fs';
import path from 'path';
import i18n from '../../unified-app/src/i18n';
import AppTitleBar from '../../unified-app/src/components/AppTitleBar';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let minimizeSpy: ReturnType<typeof vi.fn>;
let maximizeSpy: ReturnType<typeof vi.fn>;
let closeSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  minimizeSpy = vi.fn();
  maximizeSpy = vi.fn();
  closeSpy = vi.fn();
  (window as any).electron = { minimize: minimizeSpy, maximize: maximizeSpy, close: closeSpy };
});

afterEach(() => {
  if (root) { act(() => { root!.unmount(); }); root = null; }
  if (container) { container.remove(); container = null; }
  delete (window as any).electron;
});

function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter>
        <AppTitleBar />
      </MemoryRouter>
    );
  });
  return container;
}

function getButtons(el: HTMLElement) {
  const buttons = Array.from(el.querySelectorAll('button'));
  const byTitle = (title: string) => buttons.find(b => b.getAttribute('title') === title)!;
  return {
    minimize: byTitle(i18n.t('titlebar.minimize')),
    maximizeRestore: byTitle(i18n.t('titlebar.maximizeRestore')),
    close: byTitle(i18n.t('titlebar.close')),
  };
}

describe('AppTitleBar window controls', () => {
  it('renders the minimize, maximize/restore, and close controls', () => {
    const el = render();
    const { minimize, maximizeRestore, close } = getButtons(el);
    expect(minimize).toBeTruthy();
    expect(maximizeRestore).toBeTruthy();
    expect(close).toBeTruthy();
  });

  it('minimize control invokes window.electron.minimize()', () => {
    const el = render();
    const { minimize } = getButtons(el);
    act(() => { minimize.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(minimizeSpy).toHaveBeenCalledTimes(1);
    expect(maximizeSpy).not.toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('maximize/restore control invokes window.electron.maximize() (main process already toggles maximize/unmaximize)', () => {
    const el = render();
    const { maximizeRestore } = getButtons(el);
    act(() => { maximizeRestore.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(maximizeSpy).toHaveBeenCalledTimes(1);
    expect(minimizeSpy).not.toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('close control invokes window.electron.close()', () => {
    const el = render();
    const { close } = getButtons(el);
    act(() => { close.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(minimizeSpy).not.toHaveBeenCalled();
    expect(maximizeSpy).not.toHaveBeenCalled();
  });

  it('button click targets are larger than the previous 20px (w-5 h-5) buttons', () => {
    const el = render();
    const { minimize, maximizeRestore, close } = getButtons(el);
    for (const btn of [minimize, maximizeRestore, close]) {
      expect(btn.className).not.toContain('w-5');
      expect(btn.className).toContain('w-9');
      expect(btn.className).toContain('h-8');
    }
  });

  it('each control has an accessible title/aria-label identifying its action', () => {
    const el = render();
    const { minimize, maximizeRestore, close } = getButtons(el);
    expect(minimize.getAttribute('aria-label')).toBe(i18n.t('titlebar.minimize'));
    expect(maximizeRestore.getAttribute('aria-label')).toBe(i18n.t('titlebar.maximizeRestore'));
    expect(close.getAttribute('aria-label')).toBe(i18n.t('titlebar.close'));
  });

  it('close control has a destructive (red) hover class distinct from the neutral minimize/maximize hover', () => {
    const el = render();
    const { minimize, maximizeRestore, close } = getButtons(el);
    expect(close.className).toContain('hover:bg-red-500');
    expect(minimize.className).toContain('hover:bg-white/20');
    expect(maximizeRestore.className).toContain('hover:bg-white/20');
  });

  it('all three controls remain inside the no-drag region (draggable title bar does not cover the buttons)', () => {
    const el = render();
    const { minimize, maximizeRestore, close } = getButtons(el);
    for (const btn of [minimize, maximizeRestore, close]) {
      expect(btn.className).toContain('titlebar-no-drag');
    }
  });
});

// Source-level guards: confirm this purely-visual change did not touch the
// Electron IPC surface or security configuration.
describe('Electron IPC/security surface is unchanged by this UI-only modification', () => {
  const preloadSrc = fs.readFileSync(
    path.resolve(__dirname, '../../unified-app/electron/preload/index.ts'), 'utf-8'
  );
  const mainSrc = fs.readFileSync(
    path.resolve(__dirname, '../../unified-app/electron/main/index.ts'), 'utf-8'
  );

  it('preload still exposes exactly the same three window-control IPC sends (no new channel added)', () => {
    expect(preloadSrc).toMatch(/minimize:\s*\(\)\s*=>\s*ipcRenderer\.send\("app:minimize"\)/);
    expect(preloadSrc).toMatch(/maximize:\s*\(\)\s*=>\s*ipcRenderer\.send\("app:maximize"\)/);
    expect(preloadSrc).toMatch(/close:\s*\(\)\s*=>\s*ipcRenderer\.send\("app:close"\)/);
    // No new window-control-adjacent channel (e.g. a maximized-state query/event).
    expect(preloadSrc).not.toMatch(/app:is-?maximized/i);
    expect(preloadSrc).not.toMatch(/onMaximizeChange/i);
  });

  it('main process still handles the same three channels, and maximize still toggles maximize/unmaximize based on isMaximized()', () => {
    expect(mainSrc).toMatch(/ipcMain\.on\("app:minimize",\s*\(\)\s*=>\s*mainWindow\?\.minimize\(\)\)/);
    expect(mainSrc).toMatch(/ipcMain\.on\("app:maximize",\s*\(\)\s*=>\s*mainWindow\?\.isMaximized\(\)\s*\?\s*mainWindow\?\.unmaximize\(\)\s*:\s*mainWindow\?\.maximize\(\)\)/);
    expect(mainSrc).toMatch(/ipcMain\.on\("app:close",\s*\(\)\s*=>\s*mainWindow\?\.close\(\)\)/);
  });

  it('BrowserWindow security configuration (sandbox, contextIsolation, no nodeIntegration) is unchanged', () => {
    const sandboxMatches = mainSrc.match(/sandbox:\s*true/g) || [];
    const contextIsolationMatches = mainSrc.match(/contextIsolation:\s*true/g) || [];
    const nodeIntegrationMatches = mainSrc.match(/nodeIntegration:\s*false/g) || [];
    expect(sandboxMatches.length).toBeGreaterThanOrEqual(2);
    expect(contextIsolationMatches.length).toBeGreaterThanOrEqual(2);
    expect(nodeIntegrationMatches.length).toBeGreaterThanOrEqual(2);
    expect(mainSrc).not.toMatch(/nodeIntegration:\s*true/);
    expect(mainSrc).not.toMatch(/sandbox:\s*false/);
    expect(mainSrc).not.toMatch(/contextIsolation:\s*false/);
  });
});
