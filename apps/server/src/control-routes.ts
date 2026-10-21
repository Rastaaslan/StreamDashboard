import type { YouTubePreparationService } from '../../../integrations/youtube/src/preparation.js';
import type { WizeBotService } from './wizebot-service.js';
import type express from 'express';
import type { ControlService } from './control-service.js';
import type { YouTubeClient } from '../../../integrations/youtube/src/client.js';
import type { ObsClient } from '../../../integrations/obs/src/client.js';

export function registerControlRoutes(options: {
  app: express.Application; control: ControlService; wizebotCommands: WizeBotService; youtube: YouTubeClient; youtubePreparation?: YouTubePreparationService; obs: ObsClient;
  timerSource(): string | undefined; state(): unknown; settings: express.RequestHandler; planningCreate: express.RequestHandler; planningUpdate: express.RequestHandler; planningDelete: express.RequestHandler; recurrence: express.RequestHandler;
  observe(): Promise<void>;
  isLocal(req: express.Request): boolean; port(): number;
}) {
  const {app,control,youtube,obs}=options;
  app.get('/api/v2/state', async(req,res,next)=>{try{await options.observe();res.json({...control.snapshot(), receipts:control.snapshot().receipts.slice(-60), host:{...options.state() as object,local:options.isLocal(req)}});}catch(e){next(e);}});
  app.put('/api/v2/configuration',async(req,res,next)=>{try {res.json(await control.configure(req.body.configuration,req.body.expectedRevision));}catch(e){next(e);}});
  app.post('/api/v2/actions',async(req,res,next)=>{
    try {
      const selected=control.snapshot().configuration.actions.find(a=>a.id===req.body.action);
      const action=selected && ['live.start','live.stop'].includes(selected.type)?selected.type:req.body.action;
      // A retained native binding may predate a remote change of this action's type.
      // Resolve against the current server configuration before allowing a shortcut.
      if (req.body.trigger === 'keyboard' && action === 'live.stop') {
        res.status(409).json({ok:false,error:{code:'CONFIRM_REQUIRED',message:'Confirmez l’arrêt depuis le bouton du tableau de bord.',retryable:false}});
        return;
      }
      res.json(await control.execute({...req.body,action}, async action=>{res.locals.checkDevicePermission?.(action);await res.locals.checkDeviceRole?.(action);}));
    } catch(e){next(e);}
  });
  app.get('/api/v2/wizebot/catalog',(_req,res)=>res.json(options.wizebotCommands.snapshot()));
  app.post('/api/v2/wizebot/refresh',async(_req,res,next)=>{try{res.json(await options.wizebotCommands.refresh());}catch(e){next(e);}});
  app.post('/api/v2/wizebot/import',async(req,res,next)=>{try{res.json(await options.wizebotCommands.import(control,req.body.ids,req.body.expectedRevision,req.body.channel));}catch(e){next(e);}});
  app.post('/api/v2/wizebot/edit',async(req,res,next)=>{try{res.json(await options.wizebotCommands.edit(req.body));}catch(e){next(e);}});
  app.get('/api/v2/replay', async(_req,res) => {
    try { res.json(await obs.replayStatus()); }
    catch(e) { res.json({ active: null, enabled: null, available: null, mode: null, seconds: null, directory: '', error: e instanceof Error ? e.message : 'Replay indisponible.' }); }
  });
  const timerOverlay = async () => {
    const source = options.timerSource() || '', expectedUrl = `http://127.0.0.1:${options.port()}/overlay/timer/`;
    try { if (!source) throw new Error('Sélectionnez la source navigateur du minuteur dans Configuration → OBS.'); await obs.verifyTimerBrowserSource(source,expectedUrl); return {source,expectedUrl,ready:true,error:''}; }
    catch(e){return {source,expectedUrl,ready:false,error:e instanceof Error?e.message:'Vérification indisponible.'};}
  };
  app.get('/api/v2/timer/overlay',async(_req,res)=>{res.json(await timerOverlay());});
  app.post('/api/v2/timer/overlay',async(_req,res,next)=>{try{
    const source=options.timerSource();if(!source)throw new Error('Sélectionnez la source navigateur du minuteur dans Configuration → OBS.');
    await obs.reconnectTimerBrowserSource(source,`http://127.0.0.1:${options.port()}/overlay/timer/`);res.json(await timerOverlay());
  }catch(e){next(e);}});
  app.get('/api/v2/outputs',async(_req,res,next)=>{
    try {
      const [native,suite]=await Promise.allSettled([obs.outputs(),obs.streamSuiteOutputs()]);
      if (native.status==='rejected' && suite.status==='rejected') throw new Error('Impossible de détecter les sorties. Vérifiez la connexion OBS et le chargement de Stream Suite.');
      res.json({outputs:native.status==='fulfilled'?native.value:[],streamSuite:suite.status==='fulfilled'?suite.value:{error:'Stream Suite non détecté sur cette connexion OBS.'}});
    } catch(e){next(e);}
  });
  app.get('/api/v2/youtube',async(_req,res,next)=>{try{res.json(await youtube.status());}catch(e){next(e);}});
  app.get('/api/v2/youtube/chat',async(req,res,next)=>{try{res.json(await youtube.readChat(typeof req.query.broadcastId==='string'?req.query.broadcastId:undefined));}catch(e){next(e);}});
  app.get('/api/v2/youtube/broadcasts',async(_req,res,next)=>{try{res.json({items:await youtube.broadcasts()});}catch(e){next(e);}});
  app.get('/api/v2/youtube/streams',async(_req,res,next)=>{try{res.json({items:await youtube.streams()});}catch(e){next(e);}});
  app.post('/api/v2/youtube/prepare',async(req,res,next)=>{try{
    if(!options.youtubePreparation)throw new Error('Préparation YouTube indisponible sur cet hôte.');
    const guard=async()=>{
      res.locals.checkDevicePermission?.('metadata.apply');await res.locals.checkDeviceRole?.('metadata.apply');
      if(req.body.expectedRevision!==control.snapshot().configuration.revision)throw new Error('La configuration a changé. Actualisez avant de préparer une diffusion.');
    };
    res.json(await options.youtubePreparation.prepare(req.body,guard));
  }catch(e){next(e);}});
  app.get('/api/v2/youtube/channels',async(_req,res,next)=>{try{res.json({items:await youtube.authorizedChannels()});}catch(e){next(e);}});
  app.get('/api/v2/youtube/metadata',async(_req,res,next)=>{try{res.json(await youtube.readMetadata());}catch(e){next(e);}});
  app.post('/api/v2/youtube/connect',(_req,res,next)=>{try{res.json(youtube.authorize(`http://127.0.0.1:${options.port()}/api/v2/youtube/callback`));}catch(e){next(e);}});
  app.get('/api/v2/youtube/callback',async(req,res,next)=>{
    try{if(!options.isLocal(req))throw new Error('La connexion YouTube se termine sur le PC de stream.'); await youtube.exchange(String(req.query.code??''),String(req.query.state??''));res.type('text/plain').send('YouTube connecté. Vous pouvez fermer cette fenêtre et revenir à StreamDashboard.');}catch(e){next(e);}
  });
  app.post('/api/v2/youtube/disconnect',async(_req,res,next)=>{try{await youtube.disconnect();res.json(await youtube.status());}catch(e){next(e);}});
  app.put('/api/v2/settings',options.settings);
  app.post('/api/v2/planning',options.planningCreate);
  app.put('/api/v2/planning/:id',options.planningUpdate);
  app.delete('/api/v2/planning/:id',options.planningDelete);
  app.put('/api/v2/planning/:id/occurrence',options.recurrence);
  app.delete('/api/v2/planning/:id/occurrence',options.recurrence);
}
