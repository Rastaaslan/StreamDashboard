export function planningFileName(period?: string): string;

export function sharePlanningPng(
  blob: Blob,
  fileName: string,
  nativeBridge?: { shareImage?: (encodedPng: string, requestedName: string, mimeType: string) => string },
  navigatorApi?: { share?: (data: ShareData) => Promise<void>; canShare?: (data?: ShareData) => boolean },
  documentApi?: Pick<Document, 'createElement'>,
  urlApi?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>,
): Promise<'android' | 'web-share' | 'download'>;

export function exportPlanningImage(
  items: unknown[],
  streamerName?: string,
  options?: {
    period?: string;
    filters?: Record<string, boolean>;
    noteEnabled?: boolean;
    noteText?: string;
  },
): Promise<number>;
