import {isIP} from 'node:net';
import path from 'node:path';
import {WindowsAgentSecretStore} from './windows-secret-store.js';
import type {ManagedReadOnlyBinding,ReadOnlyGatewayConfig} from './readonly-gateway.js';

interface Reader {get(id:string):Promise<Buffer|null>}
type Opener=(directory:string)=>Promise<Reader>;
const openStore:Opener=directory=>WindowsAgentSecretStore.open(directory,{optIn:'I_ACCEPT_CURRENT_USER_DPAPI'});
const optIn='I_ACCEPT_PRIVATE_MTLS_READ_ONLY';
const localDirectory=(value:unknown):value is string=>typeof value==='string'&&
  path.isAbsolute(value)&&!value.startsWith('\\')&&!value.startsWith('//')&&
  (process.platform!=='win32'||/^[A-Za-z]:[\\/]/.test(value));
async function required(store:Reader,id:string,buffers:Buffer[]):Promise<Buffer>{
  const bytes=await store.get(id);
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>65536){
    if(Buffer.isBuffer(bytes))bytes.fill(0);throw Error('AGENT_CREDENTIAL_UNAVAILABLE');
  }
  buffers.push(bytes);return bytes;
}
function text(bytes:Buffer):string{return new TextDecoder('utf-8',{fatal:true}).decode(bytes)}
export interface ManagedAgentNetwork {
  gateway:Pick<ReadOnlyGatewayConfig,'serverKey'|'serverCertificate'|'authorizedClientFingerprint'>;
  binding:ManagedReadOnlyBinding;
  dispose():void;
}
export async function loadManagedAgentNetwork(env:NodeJS.ProcessEnv,open:Opener=openStore):Promise<ManagedAgentNetwork|undefined>{
  const fields=['SD_AGENT_MTLS_OPT_IN','SD_AGENT_MTLS_HOST','SD_AGENT_MTLS_PORT','SD_AGENT_MTLS_DPAPI_DIR'];
  if(!fields.some(key=>env[key]!==undefined))return;
  if(env.SD_AGENT_MTLS_OPT_IN!==optIn||!localDirectory(env.SD_AGENT_MTLS_DPAPI_DIR)||isIP(env.SD_AGENT_MTLS_HOST??'')!==4||
     !/^[0-9]{1,5}$/.test(env.SD_AGENT_MTLS_PORT??''))
    throw Error('AGENT_MTLS_CONFIGURATION_REQUIRED');
  const port=Number(env.SD_AGENT_MTLS_PORT);
  if(port<1024||port>65535)throw Error('AGENT_MTLS_CONFIGURATION_REQUIRED');
  const buffers:Buffer[]=[];
  try{
    const store=await open(env.SD_AGENT_MTLS_DPAPI_DIR);
    const serverKey=await required(store,'tls_key',buffers);
    const serverCertificate=await required(store,'tls_certificate',buffers);
    const authorizedClientFingerprint=text(await required(store,'authorized_controller_fingerprint',buffers));
    return {gateway:{serverKey,serverCertificate,authorizedClientFingerprint},
      binding:{interfaceAddress:env.SD_AGENT_MTLS_HOST!,port,optIn},
      dispose(){for(const buffer of buffers)buffer.fill(0)}};
  }catch{for(const buffer of buffers)buffer.fill(0);throw Error('AGENT_MTLS_CREDENTIAL_UNAVAILABLE')}
}
