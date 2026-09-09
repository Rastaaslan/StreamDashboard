import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('streamDashboardDesktop', {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
  openTwitchActivation: (url: string): Promise<boolean> => ipcRenderer.invoke('app:open-twitch-activation', url),
  openLogs: (): Promise<void> => ipcRenderer.invoke('app:open-logs'),
  ensureObsRunning: (): Promise<{ launched: boolean; detail: string }> => ipcRenderer.invoke('app:ensure-obs-running'),
  minimize: (): void => ipcRenderer.send('app:minimize'),
  close: (): void => ipcRenderer.send('app:close'),
});
