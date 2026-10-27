export type DjiWarningCode =
  | 'telemetry-lost'
  | 'tx1-disconnected' | 'tx2-disconnected'
  | 'tx1-gauge-6' | 'tx1-gauge-7'
  | 'tx2-gauge-6' | 'tx2-gauge-7'
  | 'rx-gauge-6' | 'rx-gauge-7';

const fixedWarnings: Record<DjiWarningCode,{title:string;body:string;critical:boolean}> = {
  'telemetry-lost':{
    title:'DJI Mic 3 · surveillance interrompue',
    body:'Plus de 90 secondes sans télémétrie DJI pendant le live. Vérifiez le RX et son USB.',
    critical:true,
  },
  'tx1-disconnected':{
    title:'DJI Mic 3 · TX1 déconnecté',
    body:'TX1 s’est déconnecté du récepteur pendant le live. Vérifiez que le son est encore reçu.',
    critical:true,
  },
  'tx2-disconnected':{
    title:'DJI Mic 3 · TX2 déconnecté',
    body:'TX2 s’est déconnecté du récepteur pendant le live. Vérifiez que le son est encore reçu.',
    critical:true,
  },
  'tx1-gauge-6':{title:'DJI Mic 3 · TX1 6/7',body:'Palier de batterie brut 6/7 : contrôlez le niveau sur le RX. Pas de pourcentage calibré.',critical:false},
  'tx1-gauge-7':{title:'DJI Mic 3 · TX1 7/7',body:'Palier de batterie brut 7/7 : contrôlez le niveau sur le RX. Pas de pourcentage calibré.',critical:false},
  'tx2-gauge-6':{title:'DJI Mic 3 · TX2 6/7',body:'Palier de batterie brut 6/7 : contrôlez le niveau sur le RX. Pas de pourcentage calibré.',critical:false},
  'tx2-gauge-7':{title:'DJI Mic 3 · TX2 7/7',body:'Palier de batterie brut 7/7 : contrôlez le niveau sur le RX. Pas de pourcentage calibré.',critical:false},
  'rx-gauge-6':{title:'DJI Mic 3 · RX 6/7',body:'Palier de batterie brut 6/7 : contrôlez le niveau sur le récepteur. Pas de pourcentage calibré.',critical:false},
  'rx-gauge-7':{title:'DJI Mic 3 · RX 7/7',body:'Palier de batterie brut 7/7 : contrôlez le niveau sur le récepteur. Pas de pourcentage calibré.',critical:false},
};
/** Renderer cannot choose notification title/body; the main process holds a strict allowlist. */
export function djiNotificationDefinition(code: unknown) {
  if (typeof code !== 'string' || !Object.hasOwn(fixedWarnings,code)) return null;
  return fixedWarnings[code as DjiWarningCode];
}
