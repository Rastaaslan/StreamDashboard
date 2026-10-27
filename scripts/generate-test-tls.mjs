#!/usr/bin/env node
/**
 * Generate disposable LOCAL test-only TLS fixtures. Never commit keys/certs.
 *
 * Android's JUnit test resource and the Node HTTPS tests must use the same
 * certificate. This helper is intentionally called only by test workflows.
 */
import {execFileSync} from 'node:child_process';
import {chmodSync,copyFileSync,existsSync,mkdirSync,mkdtempSync,
  rmSync,statSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root=process.cwd();
const testDir=path.join(root,'tests','fixtures','tls');
const androidDir=path.join(root,'android','app','src','test','resources','tls');
const key=path.join(testDir,'agent.key');
const cert=path.join(testDir,'agent.pem');
const p12=path.join(testDir,'agent.p12');
const androidP12=path.join(androidDir,'agent.p12');
const force=process.argv.includes('--force');
const all=[key,cert,p12,androidP12];
if(!force&&all.every(existsSync)){
  process.stdout.write('Test-only TLS fixtures exist; no replacement requested.\n');
  process.exit(0);
}
if(!force&&[key,cert,p12].some(existsSync)){
  throw new Error('Partial local TLS fixtures: inspect them first, then use --force on disposable test copies only.');
}
const run=(args,cwd)=>{
  try{execFileSync('openssl',args,{cwd,stdio:['ignore','pipe','pipe'],timeout:20_000})}
  catch(error){throw new Error('OpenSSL is required for disposable TLS fixtures (no production secrets): '+
    (error instanceof Error?error.message.split('\n')[0]:'unknown failure'))}
};
const temp=mkdtempSync(path.join(os.tmpdir(),'sd-fixtures-'));
try{
  run(['req','-x509','-nodes','-newkey','rsa:2048','-sha256',
    '-days','2','-subj','/CN=localhost',
    '-addext','subjectAltName=DNS:localhost,IP:127.0.0.1',
    '-addext','extendedKeyUsage=serverAuth',
    '-keyout','agent.key','-out','agent.pem'],temp);
  run(['pkcs12','-export','-in','agent.pem','-inkey','agent.key',
    '-passout','pass:test-only','-out','agent.p12'],temp);
  mkdirSync(testDir,{recursive:true,mode:0o700});
  mkdirSync(androidDir,{recursive:true,mode:0o700});
  // Never overwrite an existing key unless --force was explicitly selected.
  if(force)for(const file of all)rmSync(file,{force:true});
  for(const name of ['agent.key','agent.pem','agent.p12']){
    copyFileSync(path.join(temp,name),path.join(testDir,name));
  }
  chmodSync(key,0o600);
  copyFileSync(p12,androidP12);
  chmodSync(androidP12,0o600);
  if(!all.every(existsSync)||statSync(p12).size===0)throw new Error('TLS fixture generation failed');
  process.stdout.write('Generated ephemeral test-only TLS fixtures (gitignored, no key material logged).\n');
}finally{rmSync(temp,{recursive:true,force:true})}
