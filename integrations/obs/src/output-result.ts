/** obs-websocket request rejection codes occupy the 2xx–9xx range. Socket
 * closure codes (1000+) and transport failures do not prove non-execution. */
export function isObsRequestRejection(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'number' && Number.isInteger(code) && code >= 200 && code < 1000;
}

export function uncertainOutput(message: string) {
  return Object.assign(new Error(message), { name: 'ACTION_UNCERTAIN' });
}
