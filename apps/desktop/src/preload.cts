const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

contextBridge.exposeInMainWorld('streamDashboardDesktop', {
  configureController: (value: unknown) => ipcRenderer.invoke('controller:configure', value),
  controllerStatus: () => ipcRenderer.invoke('controller:status'),
  getControllerCredential: () => ipcRenderer.invoke('controller:credential:get'),
  setControllerCredential: (value: string) => ipcRenderer.invoke('controller:credential:set', value),
  onControllerReceipt: (callback: (receipt: unknown) => void) => { ipcRenderer.on('controller:receipt', (_event, receipt) => callback(receipt)); },
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
  getDeviceProfile: () => ipcRenderer.invoke('app:device-profile'),
  setDeviceRole: (role: string, name: string) => ipcRenderer.invoke('app:set-device-role', role, name),
  openTwitchActivation: (url: string): Promise<boolean> => ipcRenderer.invoke('app:open-twitch-activation', url),
  openExternalAuth: (url: string): Promise<boolean> => ipcRenderer.invoke('app:open-external-auth', url),
  openTwitchViewerSession: (value: {channel: string}): Promise<{status: 'closed'}> => ipcRenderer.invoke('viewer:open-twitch-session', value),
  onTwitchViewerSessionClosed: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on('viewer:twitch-session-closed', listener);
    return () => ipcRenderer.removeListener('viewer:twitch-session-closed', listener);
  },
  openLogs: (): Promise<void> => ipcRenderer.invoke('app:open-logs'),
  ensureObsRunning: (): Promise<{ launched: boolean; detail: string }> => ipcRenderer.invoke('app:ensure-obs-running'),
  selectSoundFile: (): Promise<string | null> => ipcRenderer.invoke('soundboard:select-file'),
  importSoundFile: (selectedFile: string): Promise<{ libraryId: string }> => ipcRenderer.invoke('soundboard:import-file', selectedFile),
  minimize: (): void => ipcRenderer.send('app:minimize'),
  close: (): void => ipcRenderer.send('app:close'),
});
