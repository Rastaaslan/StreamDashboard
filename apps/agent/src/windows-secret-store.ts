import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {lstat,mkdir,open,realpath,rename,rm} from 'node:fs/promises';
import path from 'node:path';

const maxSecret=65_536,maxCipher=262_144;
const magic=Buffer.from('SD-AGENT-DPAPI-1\n');
const validId=(id:string)=>/^[A-Za-z0-9_-]{1,96}$/.test(id)&&
  !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(id);
const entropy=(id:string)=>Buffer.from('StreamDashboard.AgentV2.v1\0'+id);
const unavailable=()=>Error('WINDOWS_SECRET_STORE_UNAVAILABLE');

export interface AgentDataProtection {
  protect(value:Buffer,entropy:Buffer):Promise<Buffer>;
  unprotect(value:Buffer,entropy:Buffer):Promise<Buffer>;
}
/** Windows user-profile protection, never LocalMachine or plaintext fallback.
 * This constant script accepts secrets ONLY through stdin. No credential is
 * included in process arguments, environment, a PowerShell file or diagnostics.
 * Reference: Microsoft DataProtectionScope / ProtectedData, CurrentUser.
 */
const dpapiScript=String.raw`
$ErrorActionPreference='Stop'
$inputBytes=$null;$entropyBytes=$null;$resultBytes=$null
try {
 Add-Type -AssemblyName System.Security
 $v=[Console]::In.ReadToEnd() | ConvertFrom-Json
 $inputBytes=[Convert]::FromBase64String([string]$v.data)
 $entropyBytes=[Convert]::FromBase64String([string]$v.entropy)
 if($inputBytes.Length -gt 262144 -or $entropyBytes.Length -gt 256){throw 'BOUND'}
 if($v.operation -eq 'protect'){
  $resultBytes=[Security.Cryptography.ProtectedData]::Protect($inputBytes,$entropyBytes,[Security.Cryptography.DataProtectionScope]::CurrentUser)
 }elseif($v.operation -eq 'unprotect'){
  $resultBytes=[Security.Cryptography.ProtectedData]::Unprotect($inputBytes,$entropyBytes,[Security.Cryptography.DataProtectionScope]::CurrentUser)
 }else{throw 'OPERATION'}
 [Console]::Out.Write([Convert]::ToBase64String($resultBytes))
}catch{exit 1}
finally{
 if($inputBytes){[Array]::Clear($inputBytes,0,$inputBytes.Length)}
 if($entropyBytes){[Array]::Clear($entropyBytes,0,$entropyBytes.Length)}
 if($resultBytes){[Array]::Clear($resultBytes,0,$resultBytes.Length)}
}
`;
async function nativeDpapi(operation:'protect'|'unprotect',value:Buffer,salt:Buffer):Promise<Buffer> {
  const systemRoot=process.env.SystemRoot;
  if(!systemRoot||!path.win32.isAbsolute(systemRoot))throw unavailable();
  const executable=path.win32.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const input=Buffer.from(JSON.stringify({
    operation,data:value.toString('base64'),entropy:salt.toString('base64'),
  }));
  try {
    return await new Promise<Buffer>((resolve,reject)=>{
      const child=spawn(executable,['-NoLogo','-NoProfile','-NonInteractive',
        '-EncodedCommand',Buffer.from(dpapiScript,'utf16le').toString('base64')],
        {stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false});
      const chunks:Buffer[]=[];let size=0,settled=false;
      const finish=(result?:Buffer)=>{
        if(settled){result?.fill(0);return}
        settled=true;clearTimeout(timer);
        for(const chunk of chunks)chunk.fill(0);
        if(result)resolve(result);else reject(unavailable());
      };
      const timer=setTimeout(()=>{child.kill();finish()},10_000);
      child.stdout.on('data',(chunk:Buffer)=>{
        if(settled){chunk.fill(0);return}
        size+=chunk.length;
        if(size>Math.ceil(maxCipher/3)*4+8){child.kill();finish();return}
        chunks.push(chunk);
      });
      // Never include PowerShell error messages in a caller-visible exception.
      child.stderr.resume();
      child.on('error',()=>finish());
      child.on('close',code=>{
        if(settled)return;
        if(code!==0){finish();return}
        const raw=Buffer.concat(chunks).toString('ascii');
        if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw)||
           raw.length===0){finish();return}
        const decoded=Buffer.from(raw,'base64');
        if(decoded.length>(operation==='protect'?maxCipher:maxSecret)){decoded.fill(0);finish();return}
        finish(decoded);
      });
      child.stdin.on('error',()=>{child.kill();finish()});
      child.stdin.end(input);
    });
  }catch{throw unavailable()}finally{input.fill(0)}
}

export function createCurrentUserDpapi(platform=process.platform):AgentDataProtection {
  if(platform!=='win32')throw Error('WINDOWS_DPAPI_REQUIRED');
  return {
    protect:async(value,salt)=>{
      if(!Buffer.isBuffer(value)||value.length<1||value.length>maxSecret||
         !Buffer.isBuffer(salt)||salt.length>256)throw unavailable();
      return nativeDpapi('protect',value,salt);
    },
    unprotect:async(value,salt)=>{
      if(!Buffer.isBuffer(value)||value.length<1||value.length>maxCipher||
         !Buffer.isBuffer(salt)||salt.length>256)throw unavailable();
      return nativeDpapi('unprotect',value,salt);
    },
  };
}

/** Opt-in, Node-only storage for future Agent credentials / TLS private keys.
 * This does NOT read/migrate OBS settings or start a listener/service.
 * A Windows service must run under the SAME user/profile used to provision it.
 * Same-user malware can use DPAPI; it is not an isolation boundary from that user.
 * File fsync + atomic rename; Windows rename metadata power-loss durability is
 * not guaranteed. Stale writer locks are never silently recovered.
 * Callers own plaintext Buffer results and should zero them after use.
 */
export class WindowsAgentSecretStore {
  private constructor(private readonly directory:string,private readonly protection:AgentDataProtection) {}
  static async open(directory:string,options:{
    optIn:'I_ACCEPT_CURRENT_USER_DPAPI';protection?:AgentDataProtection;
  }):Promise<WindowsAgentSecretStore> {
    if(options?.optIn!=='I_ACCEPT_CURRENT_USER_DPAPI')throw Error('WINDOWS_DPAPI_OPT_IN_REQUIRED');
    if(!path.isAbsolute(directory))throw Error('ABSOLUTE_SECRET_DIRECTORY_REQUIRED');
    const protection=options.protection??createCurrentUserDpapi();
    try {
      await mkdir(directory,{recursive:true,mode:0o700});
      const resolved=await realpath(directory),requested=path.resolve(directory);
      const normalize=(v:string)=>process.platform==='win32'?v.toLowerCase():v;
      if(normalize(resolved)!==normalize(requested)||(await lstat(directory)).isSymbolicLink())
        throw unavailable();
    }catch{throw unavailable()}
    return new WindowsAgentSecretStore(directory,protection);
  }
  private file(id:string):string {
    if(!validId(id))throw Error('INVALID_AGENT_SECRET_ID');
    return path.join(this.directory,id+'.dpapi');
  }
  async get(id:string):Promise<Buffer|null> {
    const file=this.file(id);
    let data:Buffer|undefined;
    try {
      const info=await lstat(file);
      if(!info.isFile()||info.isSymbolicLink()||info.size<=magic.length||
         info.size>maxCipher+magic.length)throw unavailable();
      const descriptor=await open(file,'r');
      try{
        const current=await descriptor.stat();
        if(!current.isFile()||current.size!==info.size)throw unavailable();
        data=Buffer.alloc(info.size);
        let offset=0;
        while(offset<data.length){
          const read=await descriptor.read(data,offset,data.length-offset,offset);
          if(read.bytesRead===0)throw unavailable();
          offset+=read.bytesRead;
        }
      }finally{await descriptor.close()}
      if(!data.subarray(0,magic.length).equals(magic))throw unavailable();
      const result=await this.protection.unprotect(data.subarray(magic.length),entropy(id));
      if(!Buffer.isBuffer(result)||result.length<1||result.length>maxSecret){
        result?.fill(0);throw unavailable();
      }
      return result;
    }catch(error){
      if((error as NodeJS.ErrnoException).code==='ENOENT')return null;
      throw unavailable();
    }finally{data?.fill(0)}
  }
  async set(id:string,value:Buffer):Promise<void> {
    const file=this.file(id);
    if(!Buffer.isBuffer(value)||value.length<1||value.length>maxSecret)
      throw Error('INVALID_AGENT_SECRET_SIZE');
    // Take ownership of a copy before any await; callers retain their Buffer.
    const copy=Buffer.from(value);
    try{
      await this.withWriter(file,async()=>{
        let encrypted:Buffer|undefined;
        const temporary=file+'.'+randomUUID()+'.tmp';
        try{
          encrypted=await this.protection.protect(copy,entropy(id));
          if(!Buffer.isBuffer(encrypted)||encrypted.length<1||encrypted.length>maxCipher)
            throw unavailable();
          const descriptor=await open(temporary,'wx',0o600);
          try{await descriptor.writeFile(Buffer.concat([magic,encrypted]));await descriptor.sync()}
          finally{await descriptor.close()}
          await rename(temporary,file);
        }finally{encrypted?.fill(0);await rm(temporary,{force:true}).catch(()=>{})}
      });
    }finally{copy.fill(0)}
  }
  async delete(id:string):Promise<void> {
    const file=this.file(id);
    await this.withWriter(file,()=>rm(file,{force:true}));
  }
  private async withWriter(file:string,work:()=>Promise<void>):Promise<void> {
    const lock=file+'.writer.lock';
    let descriptor;
    try{descriptor=await open(lock,'wx',0o600)}catch{throw Error('AGENT_SECRET_WRITER_UNAVAILABLE')}
    try{await work()}catch{throw unavailable()}
    finally{
      await descriptor.close().catch(()=>{});
      await rm(lock,{force:true}).catch(()=>{});
    }
  }
}
