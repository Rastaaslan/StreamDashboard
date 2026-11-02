import {createHash,timingSafeEqual,X509Certificate} from 'node:crypto';
import {request as httpsRequest} from 'node:https';
import {checkedEndpoint,type ReadOnlyAgentPeer} from './read-only-gateway-client.js';
import {observationFreshness,type AgentCommand,type AgentReceipt,type AgentObservation} from '../../../packages/contracts/src/agent-v2.js';

const validId=(id:unknown):id is string=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,96}$/.test(id);
/** No retry: a timed-out write is uncertain until explicitly reconciled. */
async function pinnedRequest(peer:ReadOnlyAgentPeer,route:'/v2/obs/authority'|'/v2/obs/command'|`/v2/obs/receipt/${string}`,
  body?:unknown):Promise<{status:number;value:unknown}>{
  const uri=checkedEndpoint(peer.url),fingerprint=peer.serverFingerprint.replaceAll(':','').toLowerCase();
  if(!validId(peer.expectedDeviceId)||!peer.serverCertificate||!peer.clientCertificate||
     !peer.clientKey||!/^[a-f0-9]{64}$/.test(fingerprint))throw Error('INVALID_AGENT_CLIENT_CONFIG');
  const trusted=new X509Certificate(peer.serverCertificate),pin=Buffer.from(fingerprint,'hex');
  if(!timingSafeEqual(createHash('sha256').update(trusted.raw).digest(),pin))
    throw Error('AGENT_SERVER_PIN_MISMATCH');
  const timeout=peer.timeoutMs??5000;
  if(!Number.isSafeInteger(timeout)||timeout<500||timeout>10000)throw Error('AGENT_INVALID_TIMEOUT');
  uri.pathname=route;
  const payload=body===undefined?undefined:JSON.stringify(body);
  if(payload&&Buffer.byteLength(payload)>8192)throw Error('AGENT_COMMAND_TOO_LARGE');
  return new Promise((resolve,reject)=>{
    const req=httpsRequest(uri,{
      method:payload?'POST':'GET',agent:false,ca:peer.serverCertificate,
      cert:peer.clientCertificate,key:peer.clientKey,rejectUnauthorized:true,
      minVersion:'TLSv1.3',maxVersion:'TLSv1.3',signal:peer.signal,
      headers:payload?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}:{},
      checkServerIdentity(_host,certificate){
        try{
          const cert=new X509Certificate(certificate.raw),now=Date.now();
          if(Date.parse(cert.validFrom)>now||Date.parse(cert.validTo)<=now||
             !timingSafeEqual(createHash('sha256').update(certificate.raw).digest(),pin))
            return Error('AGENT_SERVER_PIN_MISMATCH');
          return undefined;
        }catch{return Error('INVALID_AGENT_CERTIFICATE')}
      },
    },res=>{
      if(![200,202,409].includes(res.statusCode||0)||
         !String(res.headers['content-type']??'').startsWith('application/json')){
        res.resume();reject(Error('AGENT_COMMAND_ENDPOINT_UNAVAILABLE'));return;
      }
      const chunks:Buffer[]=[];let size=0;
      res.on('data',(part:Buffer)=>{
        size+=part.length;if(size>8192){req.destroy(Error('AGENT_RESPONSE_TOO_LARGE'));return}
        chunks.push(part);
      });
      res.on('end',()=>{
        try{resolve({status:res.statusCode!,value:JSON.parse(Buffer.concat(chunks).toString('utf8'))})}
        catch{reject(Error('INVALID_AGENT_RESPONSE'))}
      });res.on('error',reject);
    });
    const timer=setTimeout(()=>req.destroy(Error('AGENT_REQUEST_TIMEOUT')),timeout);
    req.once('close',()=>clearTimeout(timer));req.on('error',reject);req.end(payload);
  });
}
export async function readPinnedAgentAuthority(peer:ReadOnlyAgentPeer):
  Promise<AgentObservation<{active:boolean}>>{
  const {status,value}=await pinnedRequest(peer,'/v2/obs/authority');
  if(status!==200||!value||typeof value!=='object'||Array.isArray(value))
    throw Error('AGENT_AUTHORITY_UNAVAILABLE');
  const state=value as AgentObservation<{active:boolean}>;
  if(state.sourceDeviceId!==peer.expectedDeviceId||
     observationFreshness(state,Date.now())!=='fresh'||
     typeof state.payload?.active!=='boolean')throw Error('INVALID_AGENT_AUTHORITY');
  return state;
}
export async function sendPinnedAgentCommand(peer:ReadOnlyAgentPeer,command:AgentCommand,
  confirmedCriticalAction=false):Promise<AgentReceipt>{
  if(!validId(command?.commandId)||command.targetDeviceId!==peer.expectedDeviceId)
    throw Error('INVALID_AGENT_COMMAND_TARGET');
  const {status,value}=await pinnedRequest(peer,'/v2/obs/command',
    {command,confirmedCriticalAction});
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_AGENT_RECEIPT');
  const receipt=value as AgentReceipt;
  if(receipt.commandId!==command.commandId||
     !['confirmed','uncertain','refused'].includes(receipt.result)||
     !Number.isFinite(receipt.observedAt)||
     ((status===200)!==(receipt.result==='confirmed'))||
     ((status===202)!==(receipt.result==='uncertain'))||
     ((status===409)!==(receipt.result==='refused')))
    throw Error('INVALID_AGENT_RECEIPT');
  return receipt;
}

export type AgentReceiptLookup={commandId:string;status:'unknown'}|
  {commandId:string;status:'recorded';receipt:AgentReceipt};
/** Explicit read-only reconciliation. UNKNOWN (including no durable record) is
 * not evidence that an OBS effect did not happen and never authorises a retry. */
export async function readPinnedAgentReceipt(peer:ReadOnlyAgentPeer,commandId:string):Promise<AgentReceiptLookup>{
  if(!validId(commandId))throw Error('INVALID_AGENT_COMMAND_ID');
  const {status,value}=await pinnedRequest(peer,`/v2/obs/receipt/${commandId}`);
  if(status!==200||!value||typeof value!=='object'||Array.isArray(value))
    throw Error('INVALID_AGENT_RECEIPT_LOOKUP');
  const data=value as Partial<AgentReceiptLookup>;
  if(data.commandId!==commandId)throw Error('INVALID_AGENT_RECEIPT_LOOKUP');
  if(data.status==='unknown'&&Object.keys(data).length===2)return {commandId,status:'unknown'};
  if(data.status!=='recorded'||!data.receipt||typeof data.receipt!=='object')
    throw Error('INVALID_AGENT_RECEIPT_LOOKUP');
  const receipt=data.receipt;
  if(receipt.commandId!==commandId||!['confirmed','uncertain','refused'].includes(receipt.result)||
     !Number.isFinite(receipt.observedAt)||receipt.observedAt<0||
     (receipt.reason!==undefined&&!/^[A-Z0-9_]{1,96}$/.test(receipt.reason)))
    throw Error('INVALID_AGENT_RECEIPT_LOOKUP');
  return {commandId,status:'recorded',receipt:{commandId,result:receipt.result,
    observedAt:receipt.observedAt,...(receipt.reason?{reason:receipt.reason}:{})}};
}
