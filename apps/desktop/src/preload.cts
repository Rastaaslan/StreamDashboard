const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

contextBridge.exposeInMainWorld('streamDashboardDesktop', {
  getAgentIdentity:()=>ipcRenderer.invoke('peer:identity'),
  renewAgentIdentity:(expected:string)=>ipcRenderer.invoke('peer:renew',expected),
  getPeerFingerprint:(origin:string)=>ipcRenderer.invoke('peer:fingerprint',origin),
  trustPeer:(origin:string,fingerprint:string,expected:string)=>ipcRenderer.invoke('peer:trust',origin,fingerprint,expected),
  requestPeer:(value:unknown)=>ipcRenderer.invoke('peer:request',value),
  cancelPeerRequest:(id:string)=>ipcRenderer.invoke('peer:cancel',id),
  configureController: (value: unknown) => ipcRenderer.invoke('controller:configure', value),
  controllerStatus: () => ipcRenderer.invoke('controller:status'),
  getControllerCredential: () => ipcRenderer.invoke('controller:credential:get'),
  setControllerCredential: (value: string) => ipcRenderer.invoke('controller:credential:set', value),
  getDeviceCredential: (server: string) => ipcRenderer.invoke('controller:device-credential:get', server),
  setDeviceCredential: (server: string, credential: string) => ipcRenderer.invoke('controller:device-credential:set', server, credential),
  onControllerReceipt: (callback: (receipt: unknown) => void) => { ipcRenderer.on('controller:receipt', (_event, receipt) => callback(receipt)); },
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
  getDeviceProfile: () => ipcRenderer.invoke('app:device-profile'),
  getInstallation: () => ipcRenderer.invoke('installation:get'),
  changeInstallation: (changes: unknown, revision: number) => ipcRenderer.invoke('installation:change', changes, revision),
  restoreInstallation: (revision: number) => ipcRenderer.invoke('installation:restore', revision),
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
