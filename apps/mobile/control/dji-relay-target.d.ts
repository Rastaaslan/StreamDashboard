export interface RelayDevice { id:string; enabled:boolean; endpoint?:string; roles?:string[]; }
export interface RelayInstallation { localDeviceId:string; routes?:{obs?:string}; devices:RelayDevice[]; }
export function djiRelayTarget(context?:{installation?:RelayInstallation|null;activeServer?:string;localEndpoint?:string}):string;
