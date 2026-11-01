export type AdvancedStatus = 'available' | 'missing-scope' | 'forbidden' | 'rate-limited' | 'unknown';
export type AdvancedRequest = (path: string, body: undefined, method: 'GET', sourceKey: string) => Promise<unknown>;
export function normalizeAdvancedCapabilities(value: unknown, now?: number): {shield: AdvancedStatus; automod: AdvancedStatus; expiresAt: number};
export function mountTwitchAdvanced(root: HTMLElement, options?: {request?: AdvancedRequest}): {
  update(context?: {sourceKey?: string; online?: boolean; accountKey?: string}): void;
  refresh(): Promise<void>;
  destroy(): void;
};
