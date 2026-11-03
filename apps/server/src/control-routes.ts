import type { WizeBotService } from './wizebot-service.js';
import {publicControlReceipt,publicControlSnapshot} from './control-public-view.js';
import type express from 'express';
import type { ControlService } from './control-service.js';
import type { ObsClient } from '../../../integrations/obs/src/client.js';

export function registerControlRoutes(options: {
  app: express.Application; control: ControlService; wizebotCommands: WizeBotService; obs: ObsClient;
  timerSource(): string | undefined; state(): unknown; settings: express.RequestHandler; planningCreate: express.RequestHandler; planningUpdate: express.RequestHandler; planningDelete: express.RequestHandler; recurrence: express.RequestHandler;
  observe(): Promise<void>;
  verifyContext?(request: express.Request, action: string): Promise<void>;
  isLocal(req: express.Request): boolean; port(): number;
}) {
  const {app,control,obs}=options;
  app.get('/api/v2/state', async(req,res,next)=>{try{await options.observe();res.json({...publicControlSnapshot(control.snapshot()), receipts:control.snapshot().receipts.slice(-60).map(publicControlReceipt), host:{...options.state() as object,local:options.isLocal(req)}});}catch(e){next(e);}});
  app.put('/api/v2/configuration',async(req,res,next)=>{try {res.json(publicControlSnapshot(await control.configure(req.body.configuration,req.body.expectedRevision)));}catch(e){next(e);}});
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
      res.json(publicControlReceipt(await control.execute({...req.body,action}, async action=>{res.locals.checkDevicePermission?.(action);await res.locals.checkDeviceRole?.(action);if(req.body.expectedContextToken!==undefined){if(!options.verifyContext)throw new Error('Contexte maître indisponible.');await options.verifyContext(req,action);}})));
    } catch(e){next(e);}
  });
  app.get('/api/v2/wizebot/catalog',(_req,res)=>res.json(options.wizebotCommands.snapshot()));
  app.post('/api/v2/wizebot/refresh',async(_req,res,next)=>{try{res.json(await options.wizebotCommands.refresh());}catch(e){next(e);}});
  app.post('/api/v2/wizebot/import',async(req,res,next)=>{try{res.json(await options.wizebotCommands.import(control,req.body.ids,req.body.expectedRevision,req.body.channel));}catch(e){next(e);}});
  app.post('/api/v2/wizebot/edit',async(req,res,next)=>{try{res.json(await options.wizebotCommands.edit(req.body));}catch(e){next(e);}});
  app.get('/api/v2/replay', async(req,res) => {
    try { const status=await obs.replayStatus();res.json(options.isLocal(req)?status:{...status,directory:''}); }
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
  // Twitch-only: YouTube API endpoints are not registered.
  app.put('/api/v2/settings',options.settings);
  app.post('/api/v2/planning',options.planningCreate);
  app.put('/api/v2/planning/:id',options.planningUpdate);
  app.delete('/api/v2/planning/:id',options.planningDelete);
  app.put('/api/v2/planning/:id/occurrence',options.recurrence);
  app.delete('/api/v2/planning/:id/occurrence',options.recurrence);
}
