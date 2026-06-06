import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';
import { join } from 'path';
import Store from 'electron-store';

const store = new Store();
nativeTheme.themeSource = 'light';

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 1024, minHeight: 700,
    frame: false, show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  win.once('ready-to-show', () => win.show());
  if (process.env.NODE_ENV === 'development') {
    win.loadURL(process.env.ELECTRON_RENDERER_URL!);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
  ipcMain.on('app:minimize', () => win.minimize());
  ipcMain.on('app:maximize', () => win.isMaximized() ? win.unmaximize() : win.maximize());
  ipcMain.on('app:close', () => win.close());
  ipcMain.handle('store:get', (_, key) => store.get(key));
  ipcMain.handle('store:set', (_, key, value) => { store.set(key, value); });
  ipcMain.handle('store:delete', (_, key) => { store.delete(key); });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
