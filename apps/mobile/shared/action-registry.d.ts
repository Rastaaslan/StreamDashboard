import type { DeckAction, Outcome } from '../../../packages/contracts/src/control.js';
export const ACTION_LIMITS: Readonly<{id:number;value:number;label:number;count:number}>;
export const ACTIONS: Readonly<Record<DeckAction['type'],Readonly<{label:string;icon:string;capability:string}>>>;
export const ACTION_TYPES: readonly DeckAction['type'][];
export const OUTCOME_LABELS: Readonly<Record<Outcome,string>>;
