import type {UpgradeManifest} from '../../../packages/core/src/streamcockpit-upgrade.js';
import type {UpgradeReadbackFile} from './streamcockpit-upgrade-readback.js';

/** Publisher-bound native Squirrel package and the already installed updater. */
export interface SquirrelRelease {
 packageId:string;fromVersion:string;version:string;
 package:UpgradeReadbackFile & {sha1:string};
 updater:{bytes:number;sha256:string};
}
export interface SquirrelUpgradePaths {sourceFeed:string;backupInstallation:string}
export const squirrelFailure=(code:string)=>new Error('SC3_SQUIRREL_'+code);
const exact=(v:unknown,keys:string[])=>Boolean(v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).sort().join('|')===[...keys].sort().join('|'));
const version=/^\d+\.\d+\.\d+(?:\.\d+)?(?:-[A-Za-z0-9][A-Za-z0-9.-]{0,60})?$/;
const safeName=(s:unknown):s is string=>typeof s==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(s)&&
 !/[. ]$/.test(s)&&!/^(con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(s);
export function squirrelRelease(value:unknown):SquirrelRelease {
 const s=value as SquirrelRelease;
 if(!exact(s,['packageId','fromVersion','version','package','updater'])||!safeName(s.packageId)||
  s.packageId.length>64||!version.test(s.fromVersion)||!version.test(s.version)||s.fromVersion===s.version||
  !exact(s.package,['path','bytes','sha256','sha1'])||!safeName(s.package.path)||
  s.package.path!==s.packageId+'-'+s.version+'-full.nupkg'||
  !Number.isSafeInteger(s.package.bytes)||s.package.bytes<1||s.package.bytes>1024**3||
  !/^[a-f0-9]{64}$/.test(s.package.sha256)||!/^[a-f0-9]{40}$/.test(s.package.sha1)||
  !exact(s.updater,['bytes','sha256'])||!Number.isSafeInteger(s.updater.bytes)||
  s.updater.bytes<1||s.updater.bytes>32*1024**2||!/^[a-f0-9]{64}$/.test(s.updater.sha256))
  throw squirrelFailure('RELEASE_INVALID');
 return structuredClone(s);
}
/** Forge's NuGet prerelease spelling removes separator dots (alpha.2 -> alpha2). */
const equivalent=(a:string,b:string)=>{
 const split=(v:string)=>{const dash=v.indexOf('-');return [dash<0?v:v.slice(0,dash),dash<0?'':v.slice(dash+1)]};
 const [ac,ap]=split(a),[bc,bp]=split(b);
 const core=(v:string)=>v.split('.').map(Number).join('.').replace(/^(\d+\.\d+\.\d+)\.0$/,'$1');
 return core(ac!)===core(bc!)&&ap!.toLowerCase().replace(/[.-]/g,'')===bp!.toLowerCase().replace(/[.-]/g,'');
};
export function bindSquirrelVersions(s:SquirrelRelease,manifest:UpgradeManifest){
 if(!equivalent(s.version,manifest.version)||!equivalent(s.fromVersion,manifest.fromVersion))
  throw squirrelFailure('VERSION_BINDING_MISMATCH');
}
export function squirrelReleaseLine(s:SquirrelRelease):string {
 return s.package.sha1.toUpperCase()+' '+s.package.path+' '+s.package.bytes+'\n';
}
