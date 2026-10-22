import { YouTubeApiError } from '../../../integrations/youtube/src/client.js';

export interface PlatformObservation {
  live: boolean | null; observedAt: string; error?: string;
  id?: string; broadcastState?: string; ingestionStatus?: string | null; bound?: boolean;
}

/** Background reads share a flight and their quota clock. Explicit controls
 * have their own path: a delayed observation never blocks a local stop. */
export function createPlatformObserver(options: {
  enabled(): boolean;
  observeOutputs(): Promise<void>;
  logError(error: unknown): void;
  read(platform:'twitch'|'youtube'): Promise<PlatformObservation>;
  state: Record<string,PlatformObservation>;
  now?: () => number;
}) {
  const now=options.now||Date.now;
  let flight:Promise<void>|undefined,observedAt=0;
  const retryAt={twitch:0,youtube:0};
  return () => {
    if(!options.enabled())return Promise.resolve();
    void options.observeOutputs().catch(options.logError);
    if(flight)return flight;
    if(now()-observedAt<15000)return Promise.resolve();
    flight=Promise.allSettled((['twitch','youtube'] as const).map(async platform=>{
      if(now()<retryAt[platform])return;
      try{options.state[platform]=await options.read(platform);}
      catch(error){
        const quota=error instanceof YouTubeApiError&&['quotaExceeded','dailyLimitExceeded','rateLimitExceeded'].includes(error.reason);
        retryAt[platform]=now()+(quota?300000:30000);
        options.state[platform]={live:null,observedAt:new Date(now()).toISOString(),error:(error instanceof Error?error.message:'État indisponible')+(quota?' Nouvelle vérification automatique dans cinq minutes.':'')};
      }
    })).then(()=>{observedAt=now();}).finally(()=>{flight=undefined;});
    return flight;
  };
}
