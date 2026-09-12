export const NATIVE_ORIGIN: string;
export const DEFAULT_PORT: number;
export function isAndroidRuntime(): boolean;
export function normalizeServer(value: unknown): string;
export function parsePairing(value: unknown): { server: string; id: string; code: string };
export function apiUrl(baseUrl: string, path: string): string;
export function websocketUrl(baseUrl: string, ticket: string): string;
export function nextRetry(current: number): number;
