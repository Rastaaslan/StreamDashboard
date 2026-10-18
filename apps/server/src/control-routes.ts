import type express from 'express';
import type { ControlService } from './control-service.js';
import type { YouTubeClient } from '../../../integrations/youtube/src/client.js';
import type { ObsClient } from '../../../integrations/obs/src/client.js';

export function registerControlRoutes(options: {
  app: express.Application; control: ControlService; youtube: YouTubeClient; obs: ObsClient;
  state(): unknown; settings: express.RequestHandler; planningCreate: express.RequestHandler; planningUpdate: express.RequestHandler; planningDelete: express.RequestHandler; recurrence: express.RequestHandler;
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
      res.json(await control.execute({...req.body,action}));
    } catch(e){next(e);}
  });
  app.get('/api/v2/outputs',async(_req,res,next)=>{try{res.json({outputs:await obs.outputs()});}catch(e){next(e);}});
  app.get('/api/v2/youtube',async(_req,res,next)=>{try{res.json(await youtube.status());}catch(e){next(e);}});
  app.get('/api/v2/youtube/broadcasts',async(_req,res,next)=>{try{res.json({items:await youtube.broadcasts()});}catch(e){next(e);}});
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
