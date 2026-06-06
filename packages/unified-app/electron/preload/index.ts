import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electron", {
  minimize: () => ipcRenderer.send("app:minimize"),
  maximize: () => ipcRenderer.send("app:maximize"),
  close: () => ipcRenderer.send("app:close"),
  store: {
    get: (key: string) => ipcRenderer.invoke("store:get", key),
    set: (key: string, value: any) => ipcRenderer.invoke("store:set", key, value),
    delete: (key: string) => ipcRenderer.invoke("store:delete", key),
  },
  printToPDF: (html: string, filename: string) => ipcRenderer.invoke("print-to-pdf", { html, filename }),
  updater: {
    onAvailable: (cb: (info: { version: string }) => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: { version: string }) => cb(data);
      ipcRenderer.on("update:available", handler);
      return () => ipcRenderer.off("update:available", handler);
    },
    onProgress: (cb: (data: { percent: number }) => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: { percent: number }) => cb(data);
      ipcRenderer.on("update:progress", handler);
      return () => ipcRenderer.off("update:progress", handler);
    },
    onDownloaded: (cb: (info: { version: string }) => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: { version: string }) => cb(data);
      ipcRenderer.on("update:downloaded", handler);
      return () => ipcRenderer.off("update:downloaded", handler);
    },
    download: () => ipcRenderer.invoke("update:download"),
    install: () => ipcRenderer.invoke("update:install"),
  },
});
