export interface MobileFixtureLocation {
  hostname: string;
  search: string;
}

export interface MobileFixtureSound {
  id: string;
  name: string;
  category: string;
  volume: number;
  favorite: boolean;
  enabled: boolean;
  sourceAvailable: boolean;
}

export interface MobileVisualFixture {
  state: {
    at: string;
    mode: string;
    timer: { running: boolean; remaining: number; deadline: null };
    nextLive: Record<string, unknown>;
    planning: Array<Record<string, unknown>>;
    checklist: unknown[];
    obs: {
      connected: boolean;
      streaming: boolean;
      scene: string;
      inputs: Record<string, { muted: boolean; volumeDb: number }>;
      activeAudioInputs: string[];
      mediaInputs: string[];
    };
    settings: Record<string, unknown>;
    twitch: Record<string, unknown>;
    discord: Record<string, unknown>;
    controlHub: {
      live: Record<string, unknown>;
      audience: {
        viewerCount: number;
        chatters: Array<Record<string, unknown>>;
      };
      chat: Record<string, unknown>;
      integrations: Record<string, { status: string }>;
      activity: Array<Record<string, unknown>>;
    };
  };
  soundboard: {
    available: boolean;
    supportsExplicitOutputSelection: boolean;
    currentPlayback: null;
    sounds: MobileFixtureSound[];
  };
}

export function devFixtureName(locationLike: MobileFixtureLocation): string | null;
export function createMobileFixture(name?: string): MobileVisualFixture;
