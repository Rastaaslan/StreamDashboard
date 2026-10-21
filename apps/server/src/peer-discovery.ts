import {createSocket, type Socket} from 'node:dgram';
import {networkInterfaces} from 'node:os';
import {randomBytes} from 'node:crypto';

export const DISCOVERY_PORT=48137;
const prefix='SDNEXT21-DISCOVER:',packetSize=1024;
export interface DiscoveryIdentity {id:string;name:string;platform:'windows'|'android';port:number}
export interface DiscoveryHint extends DiscoveryIdentity {endpoint:string}
const privateAddress=(value:string)=>/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value);
const identity=(value:unknown):value is DiscoveryIdentity=>{
 const item=value as DiscoveryIdentity;
 return !!item&&/^[A-Za-z0-9_-]{1,100}$/.test(item.id)&&typeof item.name==='string'&&!!item.name.trim()&&item.name.length<=80&&['windows','android'].includes(item.platform)&&Number.isInteger(item.port)&&item.port>0&&item.port<=65535;
};
export function discoveryRequest(nonce:string){if(!/^[a-f0-9]{32}$/.test(nonce))throw Error('Invalid discovery nonce');return Buffer.from((prefix+nonce+'\n').padEnd(packetSize,' '));}
export function discoveryResponse(packet:Buffer,device:DiscoveryIdentity){
 if(packet.length!==packetSize||!identity(device))return;
 const text=packet.toString('ascii'),nonce=text.slice(prefix.length,prefix.length+32);
 if(!text.startsWith(prefix)||!/^[a-f0-9]{32}$/.test(nonce)||text[prefix.length+32]!=='\n'||text.slice(prefix.length+33).trim())return;
 return Buffer.from(JSON.stringify({protocol:'SDNEXT21',nonce,id:device.id,name:device.name,platform:device.platform,port:device.port}));
}
export function discoveryHint(packet:Buffer,address:string,nonce:string,allowLoopback=false):DiscoveryHint|undefined{
 if(packet.length>packetSize||!privateAddress(address)&&!(allowLoopback&&address==='127.0.0.1'))return;
 try{const value=JSON.parse(packet.toString('utf8'));if(value.protocol!=='SDNEXT21'||value.nonce!==nonce||!identity(value))return;
  return {id:value.id,name:value.name,platform:value.platform,port:value.port,endpoint:`https://${address}:${value.port}`};
 }catch{return;}
}
function broadcasts(){
 const targets=new Set<string>(['255.255.255.255']);
 try{for(const entries of Object.values(networkInterfaces()))for(const item of entries||[]){
  if(item.family!=='IPv4'||item.internal||!privateAddress(item.address))continue;
  const address=item.address.split('.').map(Number),mask=item.netmask.split('.').map(Number);
  targets.add(address.map((part,index)=>part|(~mask[index]&255)).join('.'));
 }}catch{/* Global subnet broadcast remains available. */}
 return [...targets];
}
const close=(socket:Socket)=>{try{socket.close();}catch{/* Already closed. */}};
/** Unauthenticated LAN hints never grant trust or carry credentials. Replies
 * are smaller than queries, rate-limited, private-address-only and bounded. */
export async function listenForPeers(describe:()=>DiscoveryIdentity|undefined,{port=DISCOVERY_PORT,host='0.0.0.0',allowLoopback=false}={}){
 const socket=createSocket('udp4'),recent=new Map<string,number>();
 socket.on('message',(packet,remote)=>{
  if(!privateAddress(remote.address)&&!(allowLoopback&&remote.address==='127.0.0.1'))return;
  const now=Date.now();if(now-(recent.get(remote.address)||0)<1000)return;
  const device=describe();if(!device)return;const response=discoveryResponse(packet,device);if(!response)return;
  recent.set(remote.address,now);if(recent.size>128)recent.delete(recent.keys().next().value!);
  socket.send(response,remote.port,remote.address,()=>{});
 });
 try{await new Promise<void>((resolve,reject)=>{socket.once('error',reject);socket.bind(port,host,()=>{socket.removeListener('error',reject);socket.on('error',()=>{});resolve();});});}
 catch(error){close(socket);throw error;}
 socket.unref();return {port:(socket.address() as {port:number}).port,close:()=>close(socket)};
}
let scanning:Promise<DiscoveryHint[]>|undefined;
export function discoverPeers({port=DISCOVERY_PORT,targets=broadcasts(),durationMs=1800,allowLoopback=false}={}){
 if(scanning)return scanning;
 scanning=new Promise<DiscoveryHint[]>((resolve,reject)=>{
  const socket=createSocket('udp4'),nonce=randomBytes(16).toString('hex'),found=new Map<string,DiscoveryHint>();let timer:NodeJS.Timeout|undefined;
  const done=(error?:Error)=>{clearTimeout(timer);close(socket);error?reject(error):resolve([...found.values()]);};
  socket.on('error',done);socket.on('message',(packet,remote)=>{if(remote.port!==port)return;const hint=discoveryHint(packet,remote.address,nonce,allowLoopback);if(hint&&found.size<64)found.set(hint.id+'@'+hint.endpoint,hint);});
  socket.bind(0,'0.0.0.0',()=>{socket.setBroadcast(true);for(const target of targets.slice(0,32))socket.send(discoveryRequest(nonce),port,target,()=>{});timer=setTimeout(()=>done(),durationMs);});
 }).finally(()=>{scanning=undefined;});return scanning;
}
