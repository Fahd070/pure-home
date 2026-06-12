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

  // Used by the Admin → Reports page to export PDFs.
  // Opens a print-preview window in the browser.
  printToPDF: (htmlContent: string, _filename: string): Promise<string> => {
    return new Promise((resolve) => {
      const printWindow = window.open('', '_blank', 'width=960,height=720');
      if (!printWindow) {
        // Pop-ups blocked — fall back to a data URI
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url  = URL.createObjectURL(blob);
        window.open(url, '_blank');
        resolve('');
        return;
      }
      printWindow.document.open();
      printWindow.document.write(htmlContent);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
        resolve('');
      }, 600);
    });
  },

  // UpdateBanner checks: if (!window.electron?.updater) return null
  // Setting to null makes the banner invisible on web.
  updater: null,
};
