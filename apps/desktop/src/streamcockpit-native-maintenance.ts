import {join} from 'node:path';
import {inspectWindowsAuthenticode,windowsApplicationEntry} from './streamcockpit-windows-authenticode.js';
import {runExternalWindowsMaintenance,type ExternalMaintenanceRequest,type ExternalMaintenanceDependencies} from './streamcockpit-external-maintenance.js';
import {verifyUpgradeReadbackFiles,type UpgradeReadbackExpectation,type UpgradeReadbackIdentity} from './streamcockpit-upgrade-readback.js';

/** Bind an authenticated expected image to real bytes, OS signer and PE product
 * version. The commit/app ID come from the publisher-bound inventory; this is
 * NOT an independent APK comparison or a claim about Windows registry entries.
 * Both the target release and trusted original snapshot must be provisioned by
 * the existing preparation flow, never learned by hashing an arbitrary folder.
 */
export function createNativeWindowsImageAttester(packageRoot:string,images:UpgradeReadbackExpectation[]){
 const expected=structuredClone(images);
 if(expected.length<1||expected.length>2)throw Error('SC3_NATIVE_IDENTITY_EXPECTATION_INVALID');
 for(const image of expected){
  windowsApplicationEntry(image.packageFiles);
  if(!/^[a-f0-9]{40}$/.test(image.identity.revision)||!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(image.identity.version)||
   !/^[a-fA-F0-9]{40}$/.test(image.identity.signer)||!image.identity.applicationId?.trim())
   throw Error('SC3_NATIVE_IDENTITY_EXPECTATION_INVALID');
 }
 return async():Promise<UpgradeReadbackIdentity|undefined>=>{
  try{
   for(const image of expected){
    if(!await verifyUpgradeReadbackFiles(packageRoot,image.packageFiles))continue;
    const entry=windowsApplicationEntry(image.packageFiles);
    const native=await inspectWindowsAuthenticode(join(packageRoot,entry.path));
    if(!native||native.status!=='valid'||native.signer!==image.identity.signer.toUpperCase()||
     native.sha256!==entry.sha256||native.version!==image.identity.version||
     !await verifyUpgradeReadbackFiles(packageRoot,image.packageFiles))continue;
    return {...image.identity,observedAt:native.observedAt};
   }
  }catch{/* No raw OS errors, retry, mutation or manufactured successful receipt. */}
  return undefined;
 };
}

/** Concrete native signature/readback wiring; deliberately no installer launch,
 * credential lookup, automatic runtime stop or unsafe live-state fallback.
 * Independent live/writer observations and explicit consent remain mandatory.
 * Caller callbacks CANNOT replace these two native trust checks in this entry.
 */
export function runNativeWindowsMaintenance(request:ExternalMaintenanceRequest,
 deps:Omit<ExternalMaintenanceDependencies,'verifyNativeSigner'>){
 const options={...request.options,attestInstalled:createNativeWindowsImageAttester(request.options.packageRoot,
  [request.options.target,request.options.rollback])};
 return runExternalWindowsMaintenance({...request,options},{...deps,verifyNativeSigner:inspectWindowsAuthenticode});
}
