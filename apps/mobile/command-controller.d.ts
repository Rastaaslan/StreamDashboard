export const COMMAND_TIMEOUT_MS: number;
export const CRITICAL_COMMAND_TIMEOUT_MS: number;
export function shouldApplyState(current: { stateRevision?: number } | null, incoming: { stateRevision?: number } | null): boolean;
export function createMobileCommandController(options: {
  transport: { command(value: any, options?: any): Promise<any>; state(options?: any): Promise<any> };
  getCredential(): string;
  applyState(state: any): void;
  notify?(message: string): void;
  makeId?(): string;
}): { execute(command: any): Promise<any>; isLocked(resource: string): boolean; resourceFor(command: any): string };
