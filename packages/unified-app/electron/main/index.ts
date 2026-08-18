import { app, BrowserWindow, ipcMain, nativeTheme } from "electron";
import { join } from "path";
import { writeFileSync } from "fs";
import Store from "electron-store";
import { autoUpdater } from "electron-updater";
import log from "electron-log/main";

const store = new Store();
nativeTheme.themeSource = "light";

// Updater events/errors are persisted locally (electron-log's default per-user
// log file) instead of being silenced. File captures routine state
// transitions too (useful for diagnosing "occasional update errors" after the
// fact); console stays quiet for routine events and only surfaces warnings/
// errors, preserving the original intent of not spamming console output on
// LAN-only deployments that may have no internet.
log.initialize();
log.transports.file.level = "info";
log.transports.console.level = "warn";

autoUpdater.logger = log;
autoUpdater.autoDownload = true;           // download silently in background
autoUpdater.autoInstallOnAppQuit = false;  // never install just because the window was closed —
                                            // install only happens via the explicit "Restart & Update"
                                            // button (ipcMain "update:install" below). A silent install
                                            // triggered by closing the app could collide with the
                                            // requireAdministrator/perMachine UAC prompt when nobody is
                                            // present to approve it (e.g. app closed over a remote session).

const ALLOWED_STORE_KEYS = new Set(["wfm-unified", "serverUrl", "language", "theme"]);

let mainWindow: BrowserWindow | null = null;

// Strips anything that could be sensitive or overly technical before an
// updater error ever reaches the renderer: local filesystem paths, and any
// token/key/secret/password/auth query-string value that might appear in a
// download-URL error. Stack traces are never included at all (only
// `err.message` is read below) — full diagnostics stay in the local log file.
function sanitizeUpdaterError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "Unknown error");
  return raw
    .replace(/[A-Za-z]:\\[^\s"']+/g, "[local path]")
    .replace(/([?&](?:token|key|password|secret|auth)=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 300);
}

// ─── Auto-updater ────────────────────────────────────────────────────────────

function setupUpdater(): void {
  log.info(`[updater] app version ${app.getVersion()} — starting update check lifecycle`);

  autoUpdater.on("checking-for-update", () => {
    log.info("[updater] checking for update...");
  });

  autoUpdater.on("update-available", (info) => {
    log.info(`[updater] update available: v${info.version}`);
    mainWindow?.webContents.send("update:available", { version: info.version });
  });

  autoUpdater.on("update-not-available", (info) => {
    log.info(`[updater] no update available (current: v${info.version})`);
  });

  autoUpdater.on("download-progress", (p) => {
    // Rounded to the nearest 10% so this doesn't flood the log on a slow link —
    // renderer still gets every event for a smooth progress bar.
    const percent = Math.round(p.percent);
    if (percent % 10 === 0) log.info(`[updater] download progress: ${percent}%`);
    mainWindow?.webContents.send("update:progress", { percent });
  });

  autoUpdater.on("update-downloaded", (info) => {
    log.info(`[updater] update downloaded and ready: v${info.version}`);
    mainWindow?.webContents.send("update:downloaded", { version: info.version });
  });

  autoUpdater.on("error", (err) => {
    // Full error (including stack) goes to the local log file only.
    log.error("[updater] error:", err);
    // Renderer gets a short, safe, normalized message only — never a raw
    // stack trace, filesystem path, or token. The app keeps running either
    // way; a failed update check/download is never fatal.
    mainWindow?.webContents.send("update:error", { message: sanitizeUpdaterError(err) });
  });

  ipcMain.handle("update:download", () => autoUpdater.downloadUpdate());
  ipcMain.handle("update:install", () => {
    log.info("[updater] install requested explicitly by user");
    return autoUpdater.quitAndInstall(false, true);
  });

  // Silent check 5 s after launch so the UI is fully ready before any banner shows
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      // checkForUpdates() already emits "error" above in the normal case; this
      // catch only guards against a network/DNS failure rejecting the promise
      // itself (e.g. no internet on a LAN-only deployment) so it can never
      // reach an unhandled rejection. Non-fatal: the app continues normally.
      log.warn("[updater] checkForUpdates() rejected:", err instanceof Error ? err.message : err);
      mainWindow?.webContents.send("update:error", { message: sanitizeUpdaterError(err) });
    });
  }, 5000);
}

// ─── PDF export ──────────────────────────────────────────────────────────────

ipcMain.handle("print-to-pdf", async (_, { html, filename }: { html: string; filename: string }) => {
  if (typeof html !== "string" || html.length > 5 * 1024 * 1024) {
    throw new Error("Invalid PDF content");
  }
  const safeFilename = (filename || "report.pdf").replace(/[^a-zA-Z0-9._\-؀-ۿ ]/g, "_");
  const pdfWin = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  await pdfWin.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  await new Promise(r => setTimeout(r, 1000));
  const buf = await pdfWin.webContents.printToPDF({ printBackground: true, pageSize: "A4" });
  pdfWin.close();
  const filePath = join(app.getPath("downloads"), safeFilename);
  writeFileSync(filePath, buf);
  return filePath;
});

// ─── electron-store ──────────────────────────────────────────────────────────

ipcMain.handle("store:get", (_, key: string) => {
  if (!ALLOWED_STORE_KEYS.has(key)) return undefined;
  return store.get(key);
});
ipcMain.handle("store:set", (_, key: string, value: any) => {
  if (!ALLOWED_STORE_KEYS.has(key)) return;
  store.set(key, value);
});
ipcMain.handle("store:delete", (_, key: string) => {
  if (!ALLOWED_STORE_KEYS.has(key)) return;
  store.delete(key);
});

// ─── Window ──────────────────────────────────────────────────────────────────

function createWindow(): void {
  const iconPath = join(__dirname, "../../assets/icon.png");
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 1024, minHeight: 700,
    frame: false, show: false, icon: iconPath,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());

  // Block renderer from navigating to external URLs
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const appUrl = process.env.NODE_ENV === "development"
      ? process.env.ELECTRON_RENDERER_URL!
      : `file://${join(__dirname, "../renderer/index.html")}`;
    if (!url.startsWith(appUrl) && !url.startsWith("file://")) {
      event.preventDefault();
    }
  });

  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL!);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
  ipcMain.on("app:minimize", () => mainWindow?.minimize());
  ipcMain.on("app:maximize", () => mainWindow?.isMaximized() ? mainWindow?.unmaximize() : mainWindow?.maximize());
  ipcMain.on("app:close", () => mainWindow?.close());
}

app.whenReady().then(() => {
  createWindow();
  setupUpdater();
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
