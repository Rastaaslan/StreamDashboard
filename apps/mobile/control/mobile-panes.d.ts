export interface MobilePaneDefinition { id:string;label:string;shortLabel?:string;icon:string; }
export const MOBILE_PANES:Readonly<{
  live:ReadonlyArray<MobilePaneDefinition>;
  planning:ReadonlyArray<MobilePaneDefinition>;
  deck:ReadonlyArray<MobilePaneDefinition>;
}>;
export const PANE_SLIDE_DURATION_MS:number;
export function paneSlideMotion(direction:'next'|'previous'):{
  keyframes:Array<{transform:string;opacity:number}>;
  options:{duration:number;easing:string;fill:string};
};
export interface MobilePaneNavigator {
  get(group:'live'|'planning'|'deck'):string;
  select(group:'live'|'planning'|'deck',id:string,options?:{notify?:boolean}):boolean;
  update(value?:{group?:string;compact?:boolean}):void;
  applyDom():void;
  destroy():void;
}
export function createMobilePanes(nav:HTMLElement,options?:{
  root?:HTMLElement|null;
  storage?:Pick<Storage,'getItem'|'setItem'>;
  onSelect?:(group:'live'|'planning'|'deck',id:string)=>void;
  now?:()=>number;
}):MobilePaneNavigator;
