export interface CommandExecutionResult<T = unknown> {
  accepted: boolean;
  reason?: 'busy';
  body?: { state?: T };
  reconciled?: boolean;
}

export function createCommandController<T = unknown>(options: {
  send(value: Record<string, unknown>, options: { timeoutMs?: number }): Promise<{ state?: T }>;
  readState(): Promise<T>;
  applyState(state: T): void;
  onMessage?(message: string): void;
}): {
  execute(value: Record<string, unknown>, options?: {
    resource?: string;
    timeoutMs?: number;
    reconcile?(state: T): boolean;
  }): Promise<CommandExecutionResult<T>>;
  isLocked(resource: string): boolean;
};
