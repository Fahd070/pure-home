import { app, BrowserWindow, ipcMain, nativeTheme } from "electron";
import { join } from "path";
import { writeFileSync } from "fs";
import Store from "electron-store";
import { autoUpdater } from "electron-updater";

const store = new Store();
nativeTheme.themeSource = "light";

// No console noise from updater; errors are silenced (app runs on LAN, may have no internet)
autoUpdater.logger = null;
autoUpdater.autoDownload = true;          // download silently in background
autoUpdater.autoInstallOnAppQuit = true;  // install automatically when the user closes the app

const ALLOWED_STORE_KEYS = new Set(["wfm-unified", "serverUrl", "language", "theme"]);

let mainWindow: BrowserWindow | null = null;

// ─── Auto-updater ────────────────────────────────────────────────────────────

function setupUpdater(): void {
  autoUpdater.on("update-available", (info) => {
    mainWindow?.webContents.send("update:available", { version: info.version });
  });

  autoUpdater.on("download-progress", (p) => {
    mainWindow?.webContents.send("update:progress", { percent: Math.round(p.percent) });
  });

  autoUpdater.on("update-downloaded", (info) => {
    mainWindow?.webContents.send("update:downloaded", { version: info.version });
  });

  autoUpdater.on("error", () => {
    // Silently ignore — no internet on LAN-only deployments
  });

  ipcMain.handle("update:download", () => autoUpdater.downloadUpdate());
  ipcMain.handle("update:install", () => autoUpdater.quitAndInstall(false, true));

  // Silent check 5 s after launch so the UI is fully ready before any banner shows
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
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
      contextIsolation: true, nodeIntegration: false
    }
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
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
