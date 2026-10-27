
export interface TwitchFragment { type: string; text: string; emote?: {id: string; format?: string[]}; }
export interface TwitchMessage { text: string; fragments?: TwitchFragment[]; emotes?: string; }
export function twitchEmoteUrl(id: string, animated?: boolean): string;
export function twitchMessageParts(message: TwitchMessage): Array<{type:string;text:string;id?:string;animated?:boolean}>;
export function renderTwitchMessage(body: Element, message: TwitchMessage, onLayout?: () => void): void;
