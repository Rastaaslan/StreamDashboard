import {describe,it,expect} from 'vitest';
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {createHash,X509Certificate} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:net';
import type {AddressInfo} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {WebSocketServer} from 'ws';
import {encode,decode} from '@msgpack/msgpack';
import {WindowsAgentSecretStore} from '../apps/agent/src/windows-secret-store.js';
import {readPinnedAgentAuthority,readPinnedAgentReceipt,sendPinnedAgentCommand} from '../apps/controller/src/agent-command-client.js';
import type {ReadOnlyAgentPeer} from '../apps/controller/src/read-only-gateway-client.js';
import type {AgentCommand} from '../packages/contracts/src/agent-v2.js';

const enabled=process.platform==='win32'&&process.env.SC3_AGENT_HEADLESS_PROCESS_TEST==='1';
const sha=(text:string)=>createHash('sha256').update(text).digest('base64');
async function unusedLoopbackPort():Promise<number>{
  const server=createServer();
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve())});
  const port=(server.address() as AddressInfo).port;
  await new Promise<void>(resolve=>server.close(()=>resolve()));return port;
}

describe('Windows autonomous Node Agent process with synthetic OBS and actual DPAPI/mTLS',()=>{
  it.skipIf(!enabled)('survives without Electron, renews beyond five seconds, reconciles receipts, and fences restart and disconnect',async()=>{
    const directory=await mkdtemp(path.join(tmpdir(),'sc3-headless-process-'));
    const privateDirectory=path.join(directory,'credentials'),appData=path.join(directory,'profile');
    const certs:Record<string,string>={};
    const obsPassword='SYNTHETIC_HEADLESS_ONLY',salt='SYNTHETIC_SALT',challenge='SYNTHETIC_CHALLENGE';
    let active=false,writes=0,child:ChildProcess|undefined,output='';
    let exited:Promise<number|null>|undefined;
    const obs=new WebSocketServer({host:'127.0.0.1',port:0});
    await new Promise<void>((resolve,reject)=>{obs.once('listening',()=>resolve());obs.once('error',reject)});
    obs.on('connection',socket=>{
      const send=(message:unknown)=>socket.send(encode(message));
      send({op:0,d:{obsWebSocketVersion:'5.3.1',rpcVersion:1,authentication:{challenge,salt}}});
      socket.on('message',raw=>{
        if(!Buffer.isBuffer(raw))throw Error('UNEXPECTED_OBS_MESSAGE_ENCODING');
        const message=decode(raw) as {op:number;d:{authentication?:string;requestType:string;requestId:string}};
        if(message.op===1){
          if(message.d.authentication!==sha(sha(obsPassword+salt)+challenge)){socket.close();return}
          send({op:2,d:{negotiatedRpcVersion:1}});return;
        }
        if(message.op!==6)return;
        const type=message.d.requestType;
        let data:Record<string,unknown>={};
        if(type==='GetStreamStatus')data={outputActive:active,outputBytes:0};
        else if(type==='GetCurrentProgramScene')data={currentProgramSceneName:'MAIN'};
        else if(type==='GetStats')data={renderTotalFrames:100,outputSkippedFrames:0};
        else if(type==='GetSceneList')data={scenes:[{sceneName:'MAIN'}]};
        else if(type==='StartStream'){active=true;writes++}
        else if(type==='StopStream'){active=false;writes++}
        else throw Error('UNEXPECTED_SYNTHETIC_OBS_RPC');
        send({op:7,d:{requestType:type,requestId:message.d.requestId,
          requestStatus:{result:true,code:100},responseData:data}});
      });
    });
    const stop=async()=>{
      if(!child)return;
      if(child.exitCode===null&&child.signalCode===null){
        child.send({action:'stop'});
        const code=await Promise.race([exited!,delay(5000).then(()=>{throw Error('HEADLESS_STOP_TIMEOUT')})]);
        expect(code,output).toBe(0);
      }
      child=undefined;
    };
    try{
      for(const kind of ['server','controller']){
        const key=path.join(directory,kind+'.key'),cert=path.join(directory,kind+'.pem');
        execFileSync('openssl',['req','-x509','-nodes','-newkey','rsa:2048','-sha256','-days','1',
          '-keyout',key,'-out',cert,'-subj','/CN=localhost','-addext',
          kind==='server'?'subjectAltName=DNS:localhost,IP:127.0.0.1':'extendedKeyUsage=clientAuth'],{stdio:'ignore'});
        certs[kind+'Key']=await readFile(key,'utf8');certs[kind+'Cert']=await readFile(cert,'utf8');
      }
      const store=await WindowsAgentSecretStore.open(privateDirectory,{optIn:'I_ACCEPT_CURRENT_USER_DPAPI'});
      for(const [id,value] of [['tls_key',certs.serverKey],['tls_certificate',certs.serverCert],
        ['authorized_controller_fingerprint',createHash('sha256').update(new X509Certificate(certs.controllerCert).raw).digest('hex')],
        ['obs_password',obsPassword]])await store.set(id,Buffer.from(value));
      const configDirectory=path.join(appData,'obs-studio','plugin_config','obs-websocket');
      await mkdir(configDirectory,{recursive:true});
      await writeFile(path.join(configDirectory,'config.json'),JSON.stringify({server_enabled:true,
        auth_required:true,server_port:(obs.address() as AddressInfo).port}));
      const port=await unusedLoopbackPort();
      const peer:ReadOnlyAgentPeer={url:'https://127.0.0.1:'+port+'/v2/obs/health',expectedDeviceId:'FIXE_TEST',
        serverCertificate:certs.serverCert,serverFingerprint:createHash('sha256').update(new X509Certificate(certs.serverCert).raw).digest('hex'),
        clientCertificate:certs.controllerCert,clientKey:certs.controllerKey,timeoutMs:1000};
      const env={...process.env};
      for(const key of Object.keys(env))if(/^(SD_AGENT_|SD_CONTROLLER_|STREAMDASHBOARD_AGENT_)/.test(key))delete env[key];
      Object.assign(env,{APPDATA:appData,STREAMDASHBOARD_AGENT_READONLY_OPT_IN:'I_ACCEPT_READ_ONLY',
        STREAMDASHBOARD_AGENT_DEVICE_ID:'FIXE_TEST',SD_AGENT_DPAPI_DIR:privateDirectory,
        SD_AGENT_DPAPI_OPT_IN:'I_ACCEPT_CURRENT_USER_DPAPI',SD_AGENT_MTLS_OPT_IN:'I_ACCEPT_PRIVATE_MTLS_READ_ONLY',
        SD_AGENT_MTLS_HOST:'127.0.0.1',SD_AGENT_MTLS_PORT:String(port),SD_AGENT_MTLS_DPAPI_DIR:privateDirectory,
        SD_AGENT_OBS_WRITER_OPT_IN:'I_ACCEPT_REAL_OBS_WRITES',SD_AGENT_OBS_WRITER_CONTROLLER_ID:'controller_test',
        SD_AGENT_OBS_WRITER_GRANTS:'obs.stream.start,obs.stream.stop'});
      const start=async()=>{
        output='';
        child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',
          "import {main} from './apps/agent/src/windows-readonly-service.ts'; process.on('message',m=>{if(m.action==='stop')process.emit('SIGTERM')}); await main(['--monitor','--use-local-obs-config']); if(process.connected)process.disconnect();"],
          {cwd:process.cwd(),env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe','ipc']});
        child.stdout!.on('data',chunk=>{output+=String(chunk)});child.stderr!.on('data',chunk=>{output+=String(chunk)});
        exited=new Promise<number|null>((resolve,reject)=>{child!.once('error',reject);child!.once('close',resolve)});
        const deadline=Date.now()+20000;
        while(true){
          if(child.exitCode!==null)throw Error('HEADLESS_START_FAILED: '+output);
          try{return await readPinnedAgentAuthority(peer)}catch{
            if(Date.now()>=deadline)throw Error('HEADLESS_AUTHORITY_TIMEOUT: '+output);
            await delay(50);
          }
        }
      };
      const first=await start();
      await delay(6100);
      const fresh=await readPinnedAgentAuthority(peer);
      expect(fresh.revision).toBe(first.revision);expect(fresh.observedAt).toBeGreaterThan(first.observedAt+5000);
      const command:AgentCommand={protocol:2,commandId:'headless_command',actorDeviceId:'controller_test',
        targetDeviceId:'FIXE_TEST',capability:'obs.stream.start',issuedAt:Date.now(),preconditionRevision:fresh.revision,payload:{}};
      expect((await sendPinnedAgentCommand(peer,command,true)).result).toBe('confirmed');expect(writes).toBe(1);
      for(const socket of obs.clients)socket.close();
      await delay(200);
      await expect(readPinnedAgentAuthority(peer)).rejects.toThrow();
      expect((await sendPinnedAgentCommand(peer,{...command,commandId:'after_disconnect'},true)).reason).toBe('RECONCILIATION_REQUIRED');
      expect((await readPinnedAgentReceipt(peer,command.commandId)).status).toBe('recorded');expect(writes).toBe(1);
      await stop();const restarted=await start();
      expect(restarted.revision).toBeGreaterThan(first.revision);
      expect((await sendPinnedAgentCommand(peer,{...command,issuedAt:Date.now(),commandId:'old_preview'},true)).reason).toBe('STALE_REVISION');
      expect((await sendPinnedAgentCommand(peer,{...command,issuedAt:Date.now(),preconditionRevision:restarted.revision},true)).reason).toBe('DUPLICATE_PERSISTENT');
      expect(await readPinnedAgentReceipt(peer,command.commandId)).toMatchObject({status:'recorded',receipt:{result:'confirmed'}});
      expect(writes).toBe(1);expect(output).not.toContain(obsPassword);
      await stop();
    }finally{
      if(child){child.kill();await exited}
      for(const socket of obs.clients)socket.terminate();
      await new Promise<void>(resolve=>obs.close(()=>resolve()));
      await rm(directory,{recursive:true,force:true});
    }
  },60000);
});
