import type {CalendarItem} from '../../../packages/contracts/src/index.js';
export interface HandoffTicket {id:string;from:string;to:string;item:CalendarItem}
export interface HandoffReceipt {ticket:HandoffTicket;status:'prepared'|'staged'|'released'|'active'|'aborted'|'restored'|'absent'}
export interface HandoffState {items:CalendarItem[];journal:Record<string,HandoffReceipt>}
export function planningOwned(item:CalendarItem|undefined):boolean;
export function validateHandoffTicket(ticket:unknown):HandoffTicket;
export function transitionPlanningHandoff(state:HandoffState,own:string,operation:string,ticket:HandoffTicket,proof?:HandoffReceipt):{state:HandoffState;receipt:HandoffReceipt};
