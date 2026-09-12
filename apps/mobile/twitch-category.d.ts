export interface TwitchCategory { id:string; name:string; box_art_url?:string }
export function normalizeCategoryQuery(value:unknown):string;
export function rankCategories(results:TwitchCategory[],recent:TwitchCategory[],query:string):TwitchCategory[];
export function rememberCategory(recent:TwitchCategory[],item:TwitchCategory,limit?:number):TwitchCategory[];
