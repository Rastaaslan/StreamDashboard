export function planningFileName(period?: string): string;

export function sharePlanningPng(
  blob: Blob,
  fileName: string,
  nativeBridge?: { shareImage?: (encodedPng: string, requestedName: string, mimeType: string) => string },
  navigatorApi?: {
    share?: (data: unknown) => unknown;
    canShare?: (data?: unknown) => boolean;
  },
  documentApi?: {
    createElement: (tagName: string) => {
      href?: string;
      download?: string;
      click: () => void;
    };
  },
  urlApi?: {
    createObjectURL: (blob: Blob) => string;
    revokeObjectURL: (url: string) => void;
  },
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
