export interface CommandExecutionResult<T = unknown> {
  accepted: boolean;
  reason?: 'busy' | 'stale';
  body?: { state?: T };
  reconciled?: boolean;
}

export function createCommandController<T = unknown>(options: {
  send(value: Record<string, unknown>, options: { timeoutMs?: number }): Promise<{ state?: T }>;
  readState(): Promise<T>;
  applyState(state: T): void;
  onMessage?(message: string): void;
  getGeneration?(): number;
}): {
  execute(value: Record<string, unknown>, options?: {
    resource?: string;
    timeoutMs?: number;
    reconcile?(state: T): boolean;
  }): Promise<CommandExecutionResult<T>>;
  isLocked(resource: string): boolean;
};

export function primaryMicCommand(state: {
  settings?: { primaryMicInput?: string };
  obs?: { inputs?: Record<string, { muted: boolean }> };
}): { type: 'obs.mute'; input: string; muted: boolean };

export function acceptsSnapshot(
  current: { stateRevision?: number; serverInstanceId?: string } | null,
  incoming: { stateRevision?: number; serverInstanceId?: string } | null,
): boolean;

export function confirmsObsStreaming(state: unknown, expected: boolean): boolean;
export function obsRuntimeView(state: unknown): {
  known: boolean; streaming: boolean; status: string; connectionLabel: string; obsLabel: string;
  providerStatus: string; live: boolean; liveLabel: string; buttonLabel: string;
};
