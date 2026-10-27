import type { DeckAction } from '../../../packages/contracts/src/control.js';
export function actionDefinition(value: unknown): string | null;
export function actionCapability(type: DeckAction['type']): string;
