import {copyFileSync,lstatSync,readFileSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(process.platform!=='win32'){
 console.log('Windows maker tools skipped on this host; no installer qualification.');
}else{
 if(!['x64','arm64'].includes(process.arch))throw Error('WINDOWS_MAKER_HOST_ARCH_UNSUPPORTED');
 const vendor=join(root,'node_modules/electron-winstaller/vendor');
 if(!realpathSync(vendor).startsWith(root+sep))throw Error('WINDOWS_MAKER_VENDOR_OUTSIDE_REPOSITORY');
 const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex'),files=[];
 // electron-winstaller 5.4.4 ships both architectures, but its selector can leave
 // the 7z.exe/7z.dll aliases absent. Restore only these repository dependencies.
 for(const extension of ['exe','dll']){
  const source=join(vendor,'7z-'+process.arch+'.'+extension),destination=join(vendor,'7z.'+extension);
  if(!lstatSync(source).isFile()||lstatSync(source).isSymbolicLink())throw Error('WINDOWS_MAKER_BUNDLED_TOOL_INVALID');
  const current=lstatSync(destination,{throwIfNoEntry:false});
  if(current&&(!current.isFile()||current.isSymbolicLink()))throw Error('WINDOWS_MAKER_ALIAS_UNSAFE');
  const expected=sha(source);
  if(!current||sha(destination)!==expected)copyFileSync(source,destination);
  if(sha(destination)!==expected)throw Error('WINDOWS_MAKER_TOOL_COPY_MISMATCH');
  files.push({file:'7z.'+extension,sha256:expected});
 }
 console.log(JSON.stringify({kind:'windows-maker-tools',arch:process.arch,files,userInstallation:false}));
}
