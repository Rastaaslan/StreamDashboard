import {createHash,createPublicKey,verify} from 'node:crypto';
import {basename,dirname,isAbsolute,join,resolve,sep} from 'node:path';
import {copyVerifiedUpgradeTree,createWindowsDirectoryUpgradePlanner,type DirectoryUpgradeOptions} from './streamcockpit-upgrade-directory.js';
import {verifyUpgradeReadbackFiles,type UpgradeReadbackExpectation,type UpgradeReadbackFile} from './streamcockpit-upgrade-readback.js';
import {validateUpgradeManifest,type UpgradeManifest} from '../../../packages/core/src/streamcockpit-upgrade.js';
import type {RestartSafety} from './restart-safety.js';

/** Publisher-signed APPLICATION inventory. No private profile data in a release. */
export interface SignedDirectoryImage {
  identity:UpgradeReadbackExpectation['identity'];
  packageFiles:UpgradeReadbackFile[];
}
export interface DirectoryReleaseTrust {
  keyId:string;
  /** Independently pinned SPKI PUBLIC key. Never take a key from the artifact. */
  publicKeyPem:string;
  applicationId:string;
  windowsSigner:string;
  sourceOrigin:string;
}
export interface SignedDirectoryUpgradeOptions extends DirectoryUpgradeOptions {
  sourcePackage:string;
  image:SignedDirectoryImage;
  trust:DirectoryReleaseTrust;
}
const fail=(code:string):never=>{throw Error('SC3_SIGNED_PREPARATION_'+code)};
const sha=(bytes:string)=>createHash('sha256').update(bytes).digest('hex');
function exactKeys(value:unknown,keys:string[]):boolean {
  return Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).sort().join('|')===[...keys].sort().join('|'));
}
function files(entries:UpgradeReadbackFile[]):UpgradeReadbackFile[]{
  if(!Array.isArray(entries)||!entries.length||entries.length>2048)fail('INVENTORY_INVALID');
  const seen=new Set<string>();let total=0;
  return entries.map(file=>{
    if(!exactKeys(file,['path','bytes','sha256'])||typeof file.path!=='string'||file.path.length>512||
      /[\\:\x00-\x1f]/.test(file.path)||isAbsolute(file.path)||file.path.split('/').some(part=>
        !part||part==='.'||part==='..'||/[. ]$/.test(part)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))||
      typeof file.sha256!=='string'||!/^[a-f0-9]{64}$/.test(file.sha256)||
      !Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>1024**3||seen.has(file.path.toLowerCase()))fail('INVENTORY_INVALID');
    seen.add(file.path.toLowerCase());total+=file.bytes;
    if(total>2*1024**3)fail('INVENTORY_INVALID');
    return {path:file.path,bytes:file.bytes,sha256:file.sha256};
  }).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
function imageValue(image:SignedDirectoryImage):SignedDirectoryImage{
  if(!exactKeys(image,['identity','packageFiles'])||
    !exactKeys(image.identity,['version','revision','applicationId','signer']))fail('IDENTITY_INVALID');
  const i=image.identity;
  if(typeof i.version!=='string'||!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(i.version)||
    typeof i.revision!=='string'||!/^[a-f0-9]{40}$/.test(i.revision)||
    typeof i.applicationId!=='string'||!/^[A-Za-z][A-Za-z0-9._-]{0,199}$/.test(i.applicationId)||
    typeof i.signer!=='string'||!/^[A-F0-9]{40}$/.test(i.signer))fail('IDENTITY_INVALID');
  return {identity:{version:i.version,revision:i.revision,applicationId:i.applicationId,signer:i.signer},packageFiles:files(image.packageFiles)};
}
/** Manifest.sha256 binds the full canonical image inventory, not just an EXE. */
export function directoryReleaseImageHash(image:SignedDirectoryImage):string{
  return sha(JSON.stringify(imageValue(image)));
}
/** Bytes to verify (also usable by a separate publisher). This module never signs. */
export function directoryReleaseSigningPayload(manifest:UpgradeManifest,image:SignedDirectoryImage):Buffer{
  validateUpgradeManifest(manifest);
  if(!exactKeys(manifest,['id','version','fromVersion','source','sha256','signature','schema','target'])||
    !exactKeys(manifest.signature,['keyId','value'])||!exactKeys(manifest.schema,['from','to'])||
    !['desktop','agent'].includes(manifest.target))fail('MANIFEST_INVALID');
  const canonical=imageValue(image);
  if(canonical.identity.version!==manifest.version||manifest.sha256!==directoryReleaseImageHash(canonical))fail('IMAGE_BINDING_MISMATCH');
  return Buffer.from('StreamCockpit-directory-release-v1\0'+JSON.stringify({
    id:manifest.id,version:manifest.version,fromVersion:manifest.fromVersion,target:manifest.target,
    source:manifest.source,sha256:manifest.sha256,keyId:manifest.signature.keyId,
    schema:{from:manifest.schema.from,to:manifest.schema.to},image:canonical,
  }),'utf8');
}
function authenticator(manifest:UpgradeManifest,image:SignedDirectoryImage,trust:DirectoryReleaseTrust){
  if(!trust||typeof trust.publicKeyPem!=='string'||trust.publicKeyPem.length>8192||
    !trust.publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----')||
    trust.keyId!==manifest.signature.keyId||trust.applicationId!==image.identity.applicationId||
    trust.windowsSigner!==image.identity.signer)fail('TRUST_POLICY_MISMATCH');
  let origin:string;
  try{const url=new URL(trust.sourceOrigin);origin=url.origin;
    if(url.protocol!=='https:'||url.username||url.password||url.href!==origin+'/')fail('TRUST_POLICY_MISMATCH');
  }catch{fail('TRUST_POLICY_MISMATCH')}
  if(new URL(manifest.source).origin!==origin!)fail('SOURCE_NOT_TRUSTED');
  let key:ReturnType<typeof createPublicKey>;
  try{key=createPublicKey(trust.publicKeyPem)}catch{fail('PUBLIC_KEY_INVALID')}
  if(key!.asymmetricKeyType!=='ed25519')fail('PUBLIC_KEY_INVALID');
  const payload=directoryReleaseSigningPayload(manifest,image);
  const raw=manifest.signature.value;
  if(typeof raw!=='string'||raw.length!==88)fail('SIGNATURE_INVALID');
  const signature=Buffer.from(raw,'base64');
  if(signature.length!==64||signature.toString('base64')!==raw)fail('SIGNATURE_INVALID');
  return ()=>{if(!verify(null,payload,key!,signature))fail('SIGNATURE_INVALID')};
}
const overlap=(a:string,b:string)=>{
  a=resolve(a).toLowerCase();b=resolve(b).toLowerCase();
  return a===b||a.startsWith(b+sep)||b.startsWith(a+sep);
};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

/** Concrete stage -> authenticated verify -> immutable app/data backup ->
 * byte-preserving schema preparation -> existing install/readback/rollback.
 * Supports SAME-SCHEMA directory updates only. No network, key generation,
 * installer launch, automatic runtime stop, Squirrel or Android activation.
 * Publisher authentication does NOT replace native Authenticode/installed
 * identity attestation, operator consent or a Windows/APK same-commit receipt.
 */
export function createSignedWindowsDirectoryUpgradePlanner(input:SignedDirectoryUpgradeOptions,
  dashboard:{assessRestartSafety():Promise<RestartSafety>}){
  const manifest=structuredClone(input.manifest),image=imageValue(structuredClone(input.image));
  const target=structuredClone(input.target),rollback=structuredClone(input.rollback);
  const trust=structuredClone(input.trust),authenticate=authenticator(manifest,image,trust);
  authenticate(); // Refuse forged release metadata before even registering intent.
  if(!same(imageValue({identity:target.identity,packageFiles:target.packageFiles}),image))fail('TARGET_NOT_SIGNED');
  if(manifest.schema.from!==manifest.schema.to||!same(files(target.profileFiles),files(rollback.profileFiles)))
    fail('PROFILE_MIGRATION_NOT_SUPPORTED');
  const source=input.sourcePackage;
  if(typeof source!=='string'||!isAbsolute(source)||!/^[A-Za-z]:[\\/]/.test(source)||source.slice(2).includes(':')||source.includes('\0'))
    fail('SOURCE_PATH_INVALID');
  const sourcePackage=resolve(source);
  const options={...input,manifest,target,rollback};
  const roots=[options.packageRoot,options.profileRoot,options.journalDirectory,options.preparedPackage,
    options.preparedProfile,options.backupPackage,options.backupProfile];
  const recovery=(['install','rollback']as const).flatMap(operation=>[options.packageRoot,options.profileRoot].flatMap(active=>
    ['candidate','previous'].map(suffix=>join(dirname(active),'.'+basename(active)+'.sc3-'+manifest.id+'-'+operation+'-'+suffix))));
  if([...roots,...recovery].some(root=>overlap(sourcePackage,root)))fail('SOURCE_ROOT_OVERLAP');
  const stopped=async()=>{if(await options.runtimeStopped()!==true)fail('RUNTIME_NOT_STOPPED')};
  const exact=async(root:string,expected:UpgradeReadbackFile[])=>{
    if(!await verifyUpgradeReadbackFiles(root,expected))fail('INVENTORY_CHANGED');
  };
  const contract=(value:UpgradeManifest,key?:string,operation?:string)=>{
    if(!same(value,manifest)||(operation&&key!==manifest.id+':'+operation))fail('CONTRACT_CHANGED');
    authenticate();
  };
  return createWindowsDirectoryUpgradePlanner(options,{
    stage:async(value,artifact,key)=>{
      contract(value,key,'stage');if(artifact!==sourcePackage)fail('SOURCE_SUBSTITUTED');await stopped();
      await copyVerifiedUpgradeTree(sourcePackage,options.preparedPackage,image.packageFiles);
      authenticate();await stopped();return {reference:options.preparedPackage};
    },
    verify:async(value,staged)=>{
      contract(value);return staged===options.preparedPackage&&await verifyUpgradeReadbackFiles(staged,image.packageFiles);
    },
    backup:async(value,key)=>{
      contract(value,key,'backup');await stopped();await exact(options.preparedPackage,image.packageFiles);
      await exact(options.packageRoot,rollback.packageFiles);await exact(options.profileRoot,rollback.profileFiles);
      await copyVerifiedUpgradeTree(options.packageRoot,options.backupPackage,rollback.packageFiles);
      await copyVerifiedUpgradeTree(options.profileRoot,options.backupProfile,rollback.profileFiles);
      await exact(options.packageRoot,rollback.packageFiles);await exact(options.profileRoot,rollback.profileFiles);
      await stopped();return {reference:options.backupPackage};
    },
    migrate:async(value,backup,key)=>{
      contract(value,key,'migrate');if(backup!==options.backupPackage)fail('BACKUP_SUBSTITUTED');await stopped();
      await exact(options.backupPackage,rollback.packageFiles);
      await copyVerifiedUpgradeTree(options.backupProfile,options.preparedProfile,rollback.profileFiles);
      await exact(options.preparedProfile,target.profileFiles);await stopped();
      return {reference:options.preparedProfile};
    },
  },dashboard);
}
