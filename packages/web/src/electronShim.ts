// Polyfills window.electron for the browser environment.
//
// The main React app (unified-app/src) was written for Electron but is already
// largely web-compatible:
//   - appStore uses zustand/persist → localStorage (no electron-store needed)
//   - settingsStore uses zustand/persist → localStorage
//   - UpdateBanner guards: if (!window.electron?.updater) return null
//   - AppTitleBar guards: const el = (window as any).electron; el?.minimize()
//
// This shim provides the missing pieces:
//   - printToPDF → browser window.print()
//   - updater → null so UpdateBanner renders nothing
//   - minimize/maximize/close → no-ops (buttons are visible but inert)

(window as any).electron = {
  minimize: () => {},
  maximize: () => {},
  close:    () => {},

  // appStore does NOT use electron-store — it uses zustand/persist (localStorage).
  // These stubs are a safety net only; they should never be called in practice.
  store: {
    get:    (_key: string)               => Promise.resolve(undefined),
    set:    (_key: string, _val: unknown) => Promise.resolve(),
    delete: (_key: string)               => Promise.resolve(),
  },

  // Used by the Admin → Reports/Customers/Expenses pages to export PDFs.
  //
  // SECURITY: htmlContent is built from database-controlled fields (customer names,
  // notes, expense descriptions, etc.). Those fields are HTML-escaped by the callers
  // before reaching here (see src/utils/htmlEscape.ts), but this print path is a
  // second, independent layer of defense: the document is rendered inside a
  // sandboxed <iframe> that deliberately omits `allow-same-origin`. Per the HTML
  // sandbox spec, that forces the iframe's document onto a unique, opaque origin --
  // even if a script somehow executed inside it, it would have no access to this
  // app's localStorage/sessionStorage/cookies, because opaque-origin documents never
  // share storage with the real origin that created them. `allow-scripts` is
  // deliberately NOT granted either, so injected script cannot execute at all. Only
  // `allow-modals` is granted (some browsers require it for window.print() to work
  // from a sandboxed frame). This replaces the previous implementation, which used
  // `window.open('', '_blank')` + `document.write()` -- a same-origin popup with
  // full access to this app's own localStorage (where all department JWTs are
  // persisted), which was the confirmed exploit path for audit finding F-1.
  printToPDF: (htmlContent: string, _filename: string): Promise<string> => {
    return new Promise((resolve) => {
      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-modals allow-popups');
      iframe.setAttribute('referrerpolicy', 'no-referrer');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.style.visibility = 'hidden';

      const cleanup = () => { iframe.remove(); };

      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } finally {
          resolve('');
          // Give the print dialog time to open before removing the iframe.
          setTimeout(cleanup, 1000);
        }
      };

      // srcdoc (rather than document.write into an already-same-origin window) is
      // what allows the sandbox's opaque-origin isolation to apply in the first place.
      iframe.srcdoc = htmlContent;
      document.body.appendChild(iframe);
    });
  },

  // UpdateBanner checks: if (!window.electron?.updater) return null
  // Setting to null makes the banner invisible on web.
  updater: null,
};
