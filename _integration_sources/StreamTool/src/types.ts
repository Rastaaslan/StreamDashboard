export type Mode = 'idle' | 'intro' | 'pause' | 'end';
export interface ModeConfig { text: string; durationSeconds: number; timerVisible: boolean }
export interface Profile {
  id: string; name: string; theme: string;
  modes: Record<Exclude<Mode, 'idle'>, ModeConfig>;
  scenes: { intro: string; pause: string; end: string; afterIntro: string };
  options: { autoStartStreaming: boolean; autoSwitchAfterIntro: boolean; autoReturnAfterPause: boolean };
}
export interface PublicState {
  mode: Mode; running: boolean; startedAt: number | null; deadline: number | null;
  duration: number; remaining: number; timerVisible: boolean; previousObsScene: string | null;
  sequence: number; text: string; obs: { connected: boolean; currentScene: string | null; streaming: boolean };
}
export interface ObsGateway {
  connected: boolean; currentScene: string | null; streaming: boolean;
  setScene(name: string): Promise<void>;
  setSceneAndWait(name: string): Promise<void>;
  getCurrentScene(): Promise<string>;
  startStreaming(): Promise<void>; stopStreaming(): Promise<void>;
}
