export {};

declare global {
  interface Window {
    electron: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      store: {
        get: (key: string) => Promise<any>;
        set: (key: string, value: any) => Promise<void>;
        delete: (key: string) => Promise<void>;
      };
      printToPDF: (html: string, filename: string) => Promise<string>;
      updater: {
        onAvailable: (cb: (info: { version: string }) => void) => () => void;
        onProgress: (cb: (data: { percent: number }) => void) => () => void;
        onDownloaded: (cb: (info: { version: string }) => void) => () => void;
        download: () => Promise<void>;
        install: () => Promise<void>;
      };
    };
  }
}
