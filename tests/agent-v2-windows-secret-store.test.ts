import {afterEach,describe,expect,it,vi} from 'vitest';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {mkdtemp,readFile,readdir,realpath,rename,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {WindowsAgentSecretStore,createCurrentUserDpapi,type AgentDataProtection}
  from '../apps/agent/src/windows-secret-store.js';

// Independent authenticated encryption backend for filesystem fault tests.
// This is NOT an emulation or qualification of Windows DPAPI.
function testProtection():AgentDataProtection {
  const key=randomBytes(32);
  return {
    protect:async(value,salt)=>{
      const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);
      cipher.setAAD(salt);
      const bytes=Buffer.concat([cipher.update(value),cipher.final()]);
      return Buffer.concat([nonce,cipher.getAuthTag(),bytes]);
    },
    unprotect:async(value,salt)=>{
      const cipher=createDecipheriv('aes-256-gcm',key,value.subarray(0,12));
      cipher.setAAD(salt);cipher.setAuthTag(value.subarray(12,28));
      return Buffer.concat([cipher.update(value.subarray(28)),cipher.final()]);
    },
  };
}
const directories:string[]=[];
afterEach(async()=>{for(const dir of directories.splice(0))await rm(dir,{recursive:true,force:true})});
async function fixture(protection=testProtection()){
  // Resolve the OS temporary-directory parent before creating the secret-store fixture.
  // Windows CI can expose a junction for TEMP; the production store correctly rejects alias paths.
  const dir=await mkdtemp(path.join(await realpath(tmpdir()),'sd-agent-secret-test-'));directories.push(dir);
  const options={optIn:'I_ACCEPT_CURRENT_USER_DPAPI' as const,protection};
  return {dir,options,store:await WindowsAgentSecretStore.open(dir,options)};
}
describe('Node-only Windows Agent encrypted store',()=>{
  it('requires opt-in and native Windows protection without a plaintext fallback',async()=>{
    expect(()=>createCurrentUserDpapi('linux')).toThrow('WINDOWS_DPAPI_REQUIRED');
    await expect(WindowsAgentSecretStore.open('/not-created',{} as never))
      .rejects.toThrow('WINDOWS_DPAPI_OPT_IN_REQUIRED');
    await expect(WindowsAgentSecretStore.open('relative',{optIn:'I_ACCEPT_CURRENT_USER_DPAPI'}))
      .rejects.toThrow('ABSOLUTE_SECRET_DIRECTORY_REQUIRED');
  });
  it('persists no plaintext, reopens and deletes without altering caller buffers',async()=>{
    const {dir,options,store}=await fixture(),secret=Buffer.from('FAKE_TLS_PRIVATE_KEY_qa_123');
    expect(await store.get('tls_key')).toBeNull();
    await store.set('tls_key',secret);
    const disk=await readFile(path.join(dir,'tls_key.dpapi'));
    expect(disk.includes(secret)).toBe(false);
    expect(secret.toString()).toBe('FAKE_TLS_PRIVATE_KEY_qa_123');
    const reopened=await WindowsAgentSecretStore.open(dir,options);
    const restored=await reopened.get('tls_key');
    expect(restored).toEqual(secret);restored!.fill(0);
    await reopened.delete('tls_key');
    expect(await store.get('tls_key')).toBeNull();
    expect(await readdir(dir)).toEqual([]);
  });
  it('rejects relocated ciphertext and changed bytes instead of adopting another identity',async()=>{
    const {dir,store}=await fixture();
    await store.set('tls_key',Buffer.from('FAKE_CERTIFICATE_KEY'));
    await rename(path.join(dir,'tls_key.dpapi'),path.join(dir,'obs_password.dpapi'));
    await expect(store.get('obs_password')).rejects.toThrow('WINDOWS_SECRET_STORE_UNAVAILABLE');
    await store.set('tls_key',Buffer.from('FAKE_CERTIFICATE_KEY'));
    const file=path.join(dir,'tls_key.dpapi'),bytes=await readFile(file);
    bytes[bytes.length-1]^=1;await writeFile(file,bytes);
    await expect(store.get('tls_key')).rejects.toThrow('WINDOWS_SECRET_STORE_UNAVAILABLE');
  });
  it('bounds corrupt records before invoking the decryptor',async()=>{
    const protection=testProtection(),decrypt=vi.spyOn(protection,'unprotect');
    const {dir,store}=await fixture(protection),file=path.join(dir,'tls_key.dpapi');
    await writeFile(file,Buffer.alloc(262_200,1));
    await expect(store.get('tls_key')).rejects.toThrow('WINDOWS_SECRET_STORE_UNAVAILABLE');
    await writeFile(file,Buffer.from('PLAINTEXT-IS-NEVER-ACCEPTED'));
    await expect(store.get('tls_key')).rejects.toThrow('WINDOWS_SECRET_STORE_UNAVAILABLE');
    expect(decrypt).not.toHaveBeenCalled();
  });
  it('rejects concurrent writers and preserves a stranded lock for inspection',async()=>{
    const protection=testProtection();
    let release!:()=>void,entered!:()=>void;
    const started=new Promise<void>(resolve=>{entered=resolve});
    const held=new Promise<void>(resolve=>{release=resolve});
    const original=protection.protect;
    protection.protect=async(value,salt)=>{entered();await held;return original(value,salt)};
    const {dir,options,store}=await fixture(protection);
    const peer=await WindowsAgentSecretStore.open(dir,options);
    const first=store.set('tls_key',Buffer.from('FIRST'));
    await started;
    await expect(peer.set('tls_key',Buffer.from('SECOND'))).rejects.toThrow('AGENT_SECRET_WRITER_UNAVAILABLE');
    release();await first;
    expect((await peer.get('tls_key'))?.toString()).toBe('FIRST');
    const lock=path.join(dir,'tls_key.dpapi.writer.lock');await writeFile(lock,'stranded');
    await expect(peer.delete('tls_key')).rejects.toThrow('AGENT_SECRET_WRITER_UNAVAILABLE');
    expect(await readFile(lock,'utf8')).toBe('stranded');
  });
  it('keeps the previous encrypted record if DPAPI fails and hides underlying errors',async()=>{
    const protection=testProtection(),{dir,store}=await fixture(protection);
    await store.set('tls_key',Buffer.from('OLD'));
    const before=await readFile(path.join(dir,'tls_key.dpapi'));
    protection.protect=async()=>{throw Error('SENSITIVE_ENGINE_ERROR_SHOULD_NOT_ESCAPE')};
    await expect(store.set('tls_key',Buffer.from('NEW'))).rejects
      .toThrow(/^WINDOWS_SECRET_STORE_UNAVAILABLE$/);
    expect(await readFile(path.join(dir,'tls_key.dpapi'))).toEqual(before);
    expect(await readdir(dir)).toEqual(['tls_key.dpapi']);
  });
  it('rejects traversal, alternate stream IDs and empty/oversized secrets before writing',async()=>{
    const {store,dir}=await fixture();
    for(const id of ['../escape','file:stream','a/b','CON.txt','NUL','CON','COM1','LPT9','']){
      await expect(store.set(id,Buffer.from('FAKE'))).rejects.toThrow('INVALID_AGENT_SECRET_ID');
      await expect(store.get(id)).rejects.toThrow('INVALID_AGENT_SECRET_ID');
    }
    for(const value of [Buffer.alloc(0),Buffer.alloc(65_537)])
      await expect(store.set('tls_key',value)).rejects.toThrow('INVALID_AGENT_SECRET_SIZE');
    expect(await readdir(dir)).toEqual([]);
  });
  it('rejects a symlinked record or directory',async()=>{
    const {dir,options,store}=await fixture();
    const external=path.join(dir,'external');await writeFile(external,'FAKE');
    await symlink(external,path.join(dir,'tls_key.dpapi'));
    await expect(store.get('tls_key')).rejects.toThrow('WINDOWS_SECRET_STORE_UNAVAILABLE');
    const alias=dir+'-alias';
    try{
      await symlink(dir,alias,'dir');
      await expect(WindowsAgentSecretStore.open(alias,options))
        .rejects.toThrow('WINDOWS_SECRET_STORE_UNAVAILABLE');
    }finally{await rm(alias,{force:true})}
  });
});
