export type Platform = 'twitch' | 'youtube';
export type Outcome = 'running' | 'succeeded' | 'partial' | 'failed' | 'uncertain';
export interface PlatformResult { status: Outcome; message: string; observedAt: string; live?: boolean }
export interface LiveMetadata { title: string; description: string; twitchGameId: string; youtubeCategoryId: string; tags: string[] }
export interface OutputTarget { kind: 'unconfigured' | 'main' | 'output' | 'aitum-suite'; name: string }
export interface DeckAction { id: string; label: string; type: 'mic.toggle' | 'scene.set' | 'mode.set' | 'timer.add' | 'sound.play' | 'alert.play' | 'chat.send' | 'live.start' | 'live.stop'; value: string; color: string; shortcut: string }
export interface ControlConfiguration {
  version: 1; revision: number; actions: DeckAction[];
  outputs: Record<Platform, OutputTarget>;
  youtube: { clientId: string; broadcastId: string; channelId: string };
  metadata: LiveMetadata;
}
export interface ControlRequest { id: string; issuedAt: string; action: string; platform?: Platform; expectedRevision?: number; metadata?: LiveMetadata }
export interface ControlReceipt { id: string; action: string; fingerprint: string; status: Outcome; message: string; createdAt: string; finishedAt?: string; platforms?: Partial<Record<Platform, PlatformResult>> }
export interface ControlData { configuration: ControlConfiguration; receipts: ControlReceipt[]; metadataResults: Partial<Record<Platform, PlatformResult>> }
export const defaultControlData = (): ControlData => ({
  configuration: { version: 1, revision: 0,
    outputs: { twitch: { kind: 'main', name: '' }, youtube: { kind: 'unconfigured', name: '' } },
    youtube: { clientId: '', broadcastId: '', channelId: '' },
    metadata: { title: '', description: '', twitchGameId: '', youtubeCategoryId: '20', tags: [] },
    actions: [
      { id: 'micro', label: 'Micro', type: 'mic.toggle', value: '', color: 'purple', shortcut: 'Control+Alt+Shift+F1' },
      { id: 'scene-live', label: 'Jeu', type: 'mode.set', value: 'live', color: 'purple', shortcut: 'Control+Alt+Shift+F2' },
      { id: 'scene-pause', label: 'Pause', type: 'mode.set', value: 'pause', color: 'amber', shortcut: 'Control+Alt+Shift+F3' },
      { id: 'scene-chat', label: 'Discussion', type: 'mode.set', value: 'chatting', color: 'purple', shortcut: 'Control+Alt+Shift+F4' },
      { id: 'timer-plus', label: '+ 5 minutes', type: 'timer.add', value: '300', color: 'green', shortcut: 'Control+Alt+Shift+F5' },
      { id: 'scene-intro', label: 'Introduction', type: 'mode.set', value: 'intro', color: 'purple', shortcut: 'Control+Alt+Shift+F6' },
    ],
  }, receipts: [], metadataResults: {},
});
