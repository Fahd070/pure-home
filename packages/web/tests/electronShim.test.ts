// Regression tests for audit finding F-1's second half: the web print/PDF path must
// no longer render database-controlled HTML in a same-origin context capable of
// reaching this app's localStorage (where all department JWTs are persisted).
//
// IMPORTANT SCOPE NOTE: jsdom does not implement real browser site-isolation /
// opaque-origin storage partitioning, so no automated test running under jsdom can
// literally execute a payload and prove it can't reach localStorage the way a real
// browser's sandboxing engine would. What these tests DO prove is the structural
// configuration that browsers use to enforce that isolation per the HTML spec: no
// `window.open`/`document.write` same-origin popup, a sandboxed <iframe> with
// `allow-same-origin` and `allow-scripts` both absent, and content set via `srcdoc`.
// If any of these regress, these tests fail. The actual cross-origin guarantee was
// additionally verified manually in a real browser (see the final report).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('electronShim printToPDF (web print path)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete (window as any).electron;
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('source no longer uses document.write(htmlContent) for the print path', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/electronShim.ts'), 'utf-8');
    // Strip // line-comments first -- the file legitimately documents the OLD,
    // now-removed document.write() pattern in a comment explaining the fix; only an
    // actual (non-comment) call site would be a real regression.
    const codeOnly = source
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');
    expect(codeOnly).not.toMatch(/document\.write\(/);
  });

  it('never calls window.open (no same-origin popup)', async () => {
    const openSpy = vi.spyOn(window, 'open');
    await import('../src/electronShim');
    (window as any).electron.printToPDF('<p>hello</p>', 'test.pdf');
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('renders the printable HTML inside a sandboxed iframe with neither allow-same-origin nor allow-scripts', async () => {
    await import('../src/electronShim');
    (window as any).electron.printToPDF('<p>hello</p>', 'test.pdf');
    const iframe = document.querySelector('iframe');
    expect(iframe).not.toBeNull();
    const sandbox = iframe!.getAttribute('sandbox') || '';
    // Absence of allow-same-origin is what forces the document onto a unique, opaque
    // origin (per the HTML sandbox spec) -- the actual isolation mechanism.
    expect(sandbox).not.toContain('allow-same-origin');
    // Absence of allow-scripts means injected script cannot execute at all, even
    // before considering origin isolation.
    expect(sandbox).not.toContain('allow-scripts');
  });

  it('sets content via srcdoc rather than document.write, so the sandbox can actually apply', async () => {
    await import('../src/electronShim');
    (window as any).electron.printToPDF('<p>marker-XYZ-123</p>', 'test.pdf');
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe.srcdoc).toContain('marker-XYZ-123');
  });

  it('the iframe is not granted allow-same-origin even when the printed HTML contains an XSS payload', async () => {
    await import('../src/electronShim');
    const payload = '<script>window.__xss_test = true;</script><img src=x onerror="window.__xss_test=true">';
    (window as any).electron.printToPDF(payload, 'test.pdf');
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe.srcdoc).toContain(payload);
    const sandbox = iframe.getAttribute('sandbox') || '';
    expect(sandbox).not.toContain('allow-same-origin');
    // The payload's content has no bearing on the sandbox configuration -- proving
    // the isolation is applied unconditionally, not based on inspecting the content.
    expect((window as any).__xss_test).toBeUndefined();
  });

  it('cleans up the iframe after printing (no permanent DOM growth per export)', async () => {
    vi.useFakeTimers();
    await import('../src/electronShim');
    (window as any).electron.printToPDF('<p>hello</p>', 'test.pdf');
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    // Simulate the iframe finishing its (jsdom-simulated) load.
    iframe.onload?.(new Event('load'));
    vi.runAllTimers();
    expect(document.querySelector('iframe')).toBeNull();
    vi.useRealTimers();
  });
});
