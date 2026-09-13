export function planningFileName(period?: string): string;
export const PLANNING_CANVAS: Readonly<{ width: 1080; height: 1350 }>;
export function wrapCanvasText(context: CanvasRenderingContext2D, value: unknown, maxWidth: number, maxLines?: number): string[];
export function fitCanvasText(context: CanvasRenderingContext2D, value: unknown, options: { maxWidth: number; maxLines?: number; maxSize: number; minSize: number; weight?: number }): { size: number; lines: string[] };
export function loadArtwork(url?: string, options?: Record<string, unknown>): Promise<HTMLImageElement | null>;
export function calculateTodayCards(count: number): Array<{ x: number; y: number; width: number; height: number }>;
export function renderPlanningCanvas(items: unknown[], streamerName?: string, options?: Record<string, unknown>): Promise<{ canvas: HTMLCanvasElement; count: number }>;

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
