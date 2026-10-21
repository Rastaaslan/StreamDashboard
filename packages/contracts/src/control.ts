export type Platform = 'twitch' | 'youtube';
export type Outcome = 'running' | 'succeeded' | 'partial' | 'failed' | 'uncertain';
export interface PlatformResult { status: Outcome; message: string; observedAt: string; live?: boolean }
export interface LiveMetadata { title: string; description: string; twitchGameId: string; youtubeCategoryId: string; tags: string[] }
export interface OutputTarget { kind: 'unconfigured' | 'main' | 'output' | 'aitum-suite'; name: string }
export interface DeckAction { id: string; label: string; type: 'mic.toggle' | 'scene.set' | 'mode.set' | 'timer.add' | 'sound.play' | 'sound.stop' | 'alert.play' | 'chat.send' | 'wizebot.command' | 'replay.save' | 'replay.start' | 'replay.stop' | 'live.start' | 'live.stop'; value: string; color: string; shortcut: string; wizebot?: { channel: string; id: string } }
export interface ControlConfiguration {
  version: 1; revision: number; actions: DeckAction[];
  outputs: Record<Platform, OutputTarget>;
  youtube: { clientId: string; broadcastId: string; channelId: string };
  metadata: LiveMetadata;
  replayAutoStart?: boolean;
}
export interface ControlRequest { id: string; issuedAt: string; action: string; platform?: Platform; expectedRevision?: number; metadata?: LiveMetadata; soundId?: string; expectedAction?: DeckAction }
export interface ActionResult { message: string; replayPath?: string; messageId?: string }
export interface ControlReceipt { id: string; action: string; fingerprint: string; status: Outcome; message: string; createdAt: string; finishedAt?: string; result?: ActionResult; platforms?: Partial<Record<Platform, PlatformResult>> }
// Documented global commands. Custom commands can be added without an API key.
export const wizebotPresets = (): DeckAction[] => [
  ['uptime', 'Durée du live'], ['game', 'Jeu en cours'], ['infogame', 'Infos du jeu'], ['commands', 'Liste des commandes'],
].map(([name, label]) => ({ id: `wizebot-${name}`, label, type: 'wizebot.command', value: `!${name}`, color: 'purple', shortcut: '' }));
export interface ControlData { featureVersion?: number; configuration: ControlConfiguration; receipts: ControlReceipt[]; metadataResults: Partial<Record<Platform, PlatformResult>> }
export const defaultControlData = (): ControlData => ({
  featureVersion: 5,
  configuration: { version: 1, revision: 0, replayAutoStart: true,
    outputs: { twitch: { kind: 'main', name: '' }, youtube: { kind: 'unconfigured', name: '' } },
    youtube: { clientId: '', broadcastId: '', channelId: '' },
    metadata: { title: '', description: '', twitchGameId: '', youtubeCategoryId: '20', tags: [] },
    actions: [
      { id: 'micro', label: 'Micro', type: 'mic.toggle', value: '', color: 'purple', shortcut: 'Control+Alt+Shift+F1' },
      { id: 'scene-live', label: 'Jeu', type: 'mode.set', value: 'live', color: 'purple', shortcut: 'Control+Alt+Shift+F2' },
      { id: 'scene-pause', label: 'Pause', type: 'mode.set', value: 'pause', color: 'amber', shortcut: 'Control+Alt+Shift+F3' },
      { id: 'scene-chat', label: 'Discussion', type: 'mode.set', value: 'chatting', color: 'purple', shortcut: 'Control+Alt+Shift+F4' },
      { id: 'clip-save', label: 'Sauvegarder un clip', type: 'replay.save', value: '', color: 'green', shortcut: 'Control+Alt+Shift+F5' },
      { id: 'scene-intro', label: 'Introduction', type: 'mode.set', value: 'intro', color: 'purple', shortcut: 'Control+Alt+Shift+F6' },
      ...wizebotPresets(),
    ],
  }, receipts: [], metadataResults: {},
});

export interface ControllerDestination { server:string; credential:string; deviceId:string; definition:DeckAction }
export interface ControllerConfiguration { server:string; credential:string; actions:DeckAction[]; destinations?:Record<string,ControllerDestination>; localWorkspace?:string }
