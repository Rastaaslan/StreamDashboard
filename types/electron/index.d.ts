declare module 'electron' {
  export const app: any;
  export const autoUpdater: any;
  export const contextBridge: any;
  export const dialog: any;
  export const ipcMain: any;
  export const ipcRenderer: any;
  export const safeStorage: any;
  export const shell: any;
  export class BrowserWindow {
    constructor(options?: unknown);
    webContents: any;
    once(event: string, listener: (...args: any[]) => void): this;
    loadURL(url: string): Promise<void>;
    show(): void; focus(): void; minimize(): void; isMinimized(): boolean; restore(): void; close(): void;
  }
}
