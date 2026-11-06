import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,readdir,realpath} from 'node:fs/promises';
import {isAbsolute,relative,resolve,sep} from 'node:path';
import {validateUpgradeManifest,type UpgradeManifest,type UpgradeOperation,type UpgradeReceipt} from '../../../packages/core/src/streamcockpit-upgrade.js';

/** F10 read-only proof for a pending install/rollback, never an installer.
 * All expected hashes and signer identities MUST be pinned by a separately
 * authenticated release/backup; the attester MUST independently validate
 * installed Windows identity/Authenticode. Hash equality is NOT a signature.
 * This reader has no profile discovery, process control, retry or write path.
 */
export interface UpgradeReadbackIdentity {
  version:string;revision:string;applicationId:string;signer:string;observedAt:number;
}
export interface UpgradeReadbackFile {path:string;sha256:string;bytes:number;}
export interface UpgradeReadbackExpectation {
  identity:Omit<UpgradeReadbackIdentity,'observedAt'>;
  packageFiles:UpgradeReadbackFile[];
  profileFiles:UpgradeReadbackFile[];
}
export interface UpgradeReadbackOptions {
  manifest:UpgradeManifest;
  /** Explicit trusted installation roots; NEVER infer a user's profile path. */
  packageRoot:string;
  profileRoot:string;
  target:UpgradeReadbackExpectation;
  rollback:UpgradeReadbackExpectation;
  /** Independent OS-level attestation, not a JSON file from the installation. */
  attestInstalled?:()=>Promise<UpgradeReadbackIdentity|undefined>;
  now?:()=>number;
}
const MAX_FILES=2048,MAX_FILE_BYTES=1024*1024*1024,MAX_TOTAL_BYTES=2*1024*1024*1024;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const validHash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const comparable=(path:string)=>process.platform==='win32'?path.toLowerCase():path;
const validRoot=(root:string)=>{
  if(!isAbsolute(root)||root.includes('\0')||(process.platform==='win32'&&
    (!/^[A-Za-z]:[\\/]/.test(root)||root.slice(2).includes(':'))))throw Error('UPGRADE_READBACK_BAD_ROOT');
  return resolve(root);
};
const validRelative=(name:string)=>typeof name==='string'&&name.length<=512&&
  !name.includes('\0')&&!name.includes('\\')&&!name.includes(':')&&
  name.split('/').every(part=>part.length>0&&part!=='.'&&part!=='..')&&!isAbsolute(name);
function checkInventory(entries:UpgradeReadbackFile[]){
  if(!Array.isArray(entries)||!entries.length||entries.length>MAX_FILES)
    throw Error('UPGRADE_READBACK_INVENTORY_INVALID');
  const seen=new Set<string>();let bytes=0;
  for(const file of entries){
    if(!file||!validRelative(file.path)||!validHash(file.sha256)||
      !Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>MAX_FILE_BYTES||
      seen.has(file.path.toLowerCase()))throw Error('UPGRADE_READBACK_INVENTORY_INVALID');
    seen.add(file.path.toLowerCase());bytes+=file.bytes;
    if(bytes>MAX_TOTAL_BYTES)throw Error('UPGRADE_READBACK_INVENTORY_INVALID');
  }
}
function checkExpectation(expected:UpgradeReadbackExpectation,version:string){
  if(!expected||expected.identity.version!==version||
    !/^[a-f0-9]{40}$/.test(expected.identity.revision)||!expected.identity.applicationId?.trim()||
    !expected.identity.signer?.trim())throw Error('UPGRADE_READBACK_IDENTITY_UNPINNED');
  checkInventory(expected.packageFiles);checkInventory(expected.profileFiles);
}
function matchesIdentity(actual:UpgradeReadbackIdentity|undefined,expected:UpgradeReadbackExpectation,now:number){
  if(!actual||!Number.isSafeInteger(now)||!Number.isFinite(actual.observedAt)||
    actual.observedAt>now||now-actual.observedAt>5000)return false;
  return actual.version===expected.identity.version&&actual.revision===expected.identity.revision&&
    actual.applicationId===expected.identity.applicationId&&actual.signer===expected.identity.signer;
}
/** Capture after native writers have stopped; hashes only, never private contents. */
export async function snapshotUpgradeReadbackFiles(root:string):Promise<UpgradeReadbackFile[]>{
  const canonical=await realpath(root),base=await lstat(root);
  if(!base.isDirectory()||base.isSymbolicLink()||comparable(canonical)!==comparable(root))
    throw Error('UNTRUSTED_ROOT');
  const files:UpgradeReadbackFile[]=[];let total=0;
  const visit=async(folder:string):Promise<void>=>{
    for(const name of (await readdir(folder)).sort()){
      const absolute=resolve(folder,name),part=relative(root,absolute).split(sep).join('/');
      if(!validRelative(part)||!absolute.startsWith(root+sep))throw Error('UNTRUSTED_ENTRY');
      const stat=await lstat(absolute);
      if(stat.isSymbolicLink()||comparable(await realpath(absolute))!==comparable(absolute))
        throw Error('SYMLINK_ENTRY');
      if(stat.isDirectory()){await visit(absolute);continue}
      if(!stat.isFile()||stat.nlink!==1||stat.size>MAX_FILE_BYTES||
        ++total>MAX_FILES)throw Error('UNTRUSTED_FILE');
      // Never buffer executable or private data in memory.
      const digest=createHash('sha256');
      for await(const chunk of createReadStream(absolute))digest.update(chunk as Buffer);
      const after=await lstat(absolute);
      if(!after.isFile()||after.isSymbolicLink()||after.nlink!==1||after.dev!==stat.dev||
        after.ino!==stat.ino||after.size!==stat.size||
        after.mtimeMs!==stat.mtimeMs||after.ctimeMs!==stat.ctimeMs)throw Error('FILE_CHANGED');
      files.push({path:part,sha256:digest.digest('hex'),bytes:stat.size});
      // Separate count and byte bounds so tiny receipts cannot exhaust memory.
    }
  };
  await visit(root);
  if(files.reduce((sum,file)=>sum+file.bytes,0)>MAX_TOTAL_BYTES)throw Error('TOO_LARGE');
  return files.sort((a,b)=>a.path.localeCompare(b.path));
}
function sameInventory(observed:UpgradeReadbackFile[],expected:UpgradeReadbackFile[]){
  if(observed.length!==expected.length)return false;
  const pinned=new Map(expected.map(entry=>[entry.path,entry]));
  return observed.every(entry=>{
    const item=pinned.get(entry.path);
    return item?.bytes===entry.bytes&&item.sha256===entry.sha256;
  });
}
/** Shared read-only file verification for detached copy and applied image.
 * Equality alone does not authenticate a release or authorize any replacement. */
export async function verifyUpgradeReadbackFiles(root:string,entries:UpgradeReadbackFile[]):Promise<boolean>{
  const pinned=structuredClone(entries);
  checkInventory(pinned);
  try{return sameInventory(await snapshotUpgradeReadbackFiles(validRoot(root)),pinned)}catch{return false}
}

/** Returns a durable-looking receipt ONLY after complete, exact on-disk image
 * + profile readback and two fresh independent identity checks. The caller's
 * UpgradePlanner must already hold its cross-process journal lease and possess
 * an unresolved matching operation. No receipt for stage/backup/migration.
 */
export function createUpgradeReadbackReconciler(options:UpgradeReadbackOptions):
  (operation:UpgradeOperation,key:string)=>Promise<UpgradeReceipt|undefined>{
  validateUpgradeManifest(options.manifest);
  if(options.manifest.target!=='desktop'&&options.manifest.target!=='agent')
    throw Error('UPGRADE_READBACK_WINDOWS_ONLY');
  const packageRoot=validRoot(options.packageRoot),profileRoot=validRoot(options.profileRoot);
  if(comparable(packageRoot)===comparable(profileRoot)||packageRoot.startsWith(profileRoot+sep)||
    profileRoot.startsWith(packageRoot+sep))throw Error('UPGRADE_READBACK_OVERLAPPING_ROOTS');
  checkExpectation(options.target,options.manifest.version);
  checkExpectation(options.rollback,options.manifest.fromVersion);
  return async(operation,key)=>{
    if((operation!=='install'&&operation!=='rollback')||key!==options.manifest.id+':'+operation||
      !options.attestInstalled)return undefined;
    const expected=operation==='install'?options.target:options.rollback;
    try{
      const first=await options.attestInstalled();
      const now=(options.now??Date.now)();
      if(!matchesIdentity(first,expected,now))return undefined;
      const [program,profile]=await Promise.all([snapshotUpgradeReadbackFiles(packageRoot),snapshotUpgradeReadbackFiles(profileRoot)]);
      if(!sameInventory(program,expected.packageFiles)||!sameInventory(profile,expected.profileFiles))
        return undefined;
      const final=await options.attestInstalled(),later=(options.now??Date.now)();
      if(!matchesIdentity(final,expected,later)||final!.observedAt<first!.observedAt)
        return undefined;
      return {reference:'readback:'+operation+':'+hash(JSON.stringify({
        id:options.manifest.id,operation,identity:expected.identity,program,profile,
      }))};
    }catch{
      // An unreadable, changing or untrusted observation is UNKNOWN, never
      // a reason to replay a possibly already applied installation.
      return undefined;
    }
  };
}
