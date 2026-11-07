import {afterEach,expect,it,vi} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,createHash} from 'node:crypto';
import {cp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {squirrelFixture} from './helpers/streamcockpit-squirrel-fixture.js';
import {runNativeWindowsMaintenance} from '../apps/desktop/src/streamcockpit-native-maintenance.js';
import {nativeSquirrelState} from '../apps/desktop/src/streamcockpit-squirrel-native.js';
import {inspectWindowsAuthenticode} from '../apps/desktop/src/streamcockpit-windows-authenticode.js';
import {digest} from './helpers/streamcockpit-maintenance-fixture.js';
const proof=vi.hoisted(()=>({allowTestTrust:true,nativeDiagnostic:''}));
vi.mock('node:child_process',async original=>{
 const actual=await original<typeof import('node:child_process')>();
 const wrapped=(...args:any[])=>{
  const callback=args.at(-1);
  const encoded=args[1]?.[args[1]?.indexOf('-EncodedCommand')+1];
  if(typeof callback==='function'&&typeof encoded==='string'&&Buffer.from(encoded,'base64').toString('utf16le').includes('$nativeRequest')){
   args[args.length-1]=(error:any,stdout:string,stderr:string)=>{
    proof.nativeDiagnostic=(stderr||stdout||String(error)).slice(-5000);callback(error,stdout,stderr);
   };
  }
  return (actual.execFile as any)(...args);
 };
 const custom=Symbol.for('nodejs.util.promisify.custom');
 Object.defineProperty(wrapped,custom,{value:(actual.execFile as any)[custom]});
 return {...actual,execFile:wrapped};
});
vi.mock('../apps/desktop/src/streamcockpit-windows-authenticode.js',async original=>{
 const actual=await original<typeof import('../apps/desktop/src/streamcockpit-windows-authenticode.js')>();
 return {...actual,inspectWindowsAuthenticode:async(path:string)=>{
  const native=await actual.inspectWindowsAuthenticode(path);
  // TEST ONLY: real Windows PE/hash inspection; positive certificate trust simulated.
  return native&&proof.allowTestTrust?{...native,status:'valid',signer:'A'.repeat(40)}:native;
 }};
});
const execute=promisify(execFile);
const powershell=join(process.env.SystemRoot??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
const quote=(s:string)=>"'"+s.replaceAll("'","''")+"'";
async function ps(script:string){
 return execute(powershell,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from("$ErrorActionPreference='Stop'\n"+script,'utf16le').toString('base64')],
  {windowsHide:true,encoding:'utf8',timeout:90000,maxBuffer:64*1024});
}
const created:Array<{root:string;id:string;installationRoot:string}>=[];
afterEach(async()=>{
 proof.allowTestTrust=true;
 for(const f of created.splice(0)){
  await ps("$k='Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\"+f.id+"'\n"+
   "$v=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($k)\n"+
   "if($null -ne $v){try{if($v.GetValue('InstallLocation') -ine "+quote(f.installationRoot)+"){throw 'TEST_SCOPE_CHANGED'}}finally{$v.Dispose()};[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($k)}");
  await rm(f.root,{recursive:true,force:true});
 }
});
async function realFixture(){
 const id='SC3QA_'+randomBytes(8).toString('hex'),f=await squirrelFixture(id);created.push({root:f.root,id,installationRoot:f.installationRoot});
 const vendor=resolve('node_modules/electron-winstaller/vendor'),updater=await readFile(join(vendor,'Squirrel.exe'));
 await writeFile(join(f.installationRoot,'Update.exe'),updater);
 await writeFile(join(f.installationRoot,'StreamDashboard.exe'),await readFile(join(vendor,'StubExecutable.exe')));
 for(const [folder,version]of [[f.oldRoot,'2.1.0.0'],[f.paths.sourcePackage,'3.0.0.0']]){
  const binary=join(folder!,'StreamDashboard.exe');await rm(binary);
  // Harmless console surrogate: an unknown maintenance argument exits without application data or providers.
  await cp(join(vendor,'rcedit.exe'),binary);
  await execute(join(vendor,'rcedit.exe'),[binary,'--set-version-string','SquirrelAwareVersion','1','--set-product-version',version!,'--set-file-version',version!,
   '--set-version-string','ProductVersion',version!,'--set-version-string','FileVersion',version!,
   '--set-version-string','ProductName',id,'--set-version-string','CompanyName',id,'--set-version-string','FileDescription',id],{windowsHide:true});
  await cp(join(vendor,'Squirrel.exe'),join(folder!,'squirrel.exe'));
 }
 const py="import sys,zipfile,pathlib\nbase,package_id,version,app,stub=sys.argv[1:]\nbase=pathlib.Path(base); app=pathlib.Path(app); base.mkdir(exist_ok=True,parents=True)\nname=package_id+'-'+version+'-full.nupkg'\nns='http://schemas.microsoft.com/packaging/2011/10/nuspec.xsd'\nxml='<package xmlns=\"'+ns+'\"><metadata><id>'+package_id+'</id><version>'+version+'</version><title>'+package_id+'</title><authors>'+package_id+'</authors><description>TEST ONLY Squirrel fixture</description></metadata></package>'\nwith zipfile.ZipFile(base/name,'w',zipfile.ZIP_DEFLATED) as z:\n z.writestr(package_id+'.nuspec',xml)\n z.writestr('_rels/.rels','<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Type=\"http://schemas.microsoft.com/packaging/2010/07/manifest\" Target=\"/'+package_id+'.nuspec\" Id=\"Rmanifest\"/></Relationships>')\n types='<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>'\n for ext in ['exe','nuspec','json','asar','cjs','txt']: types+='<Default Extension=\"'+ext+'\" ContentType=\"application/octet-stream\"/>'\n z.writestr('[Content_Types].xml',types+'</Types>')\n for f in sorted(app.rglob('*')):\n  if f.is_file(): z.write(f,'lib/net45/'+f.relative_to(app).as_posix())\n z.write(stub,'lib/net45/StreamDashboard_ExecutionStub.exe')\n";
 const oldName=id+'-2.1.0-full.nupkg';
 await rm(join(f.installationRoot,'packages'),{recursive:true});await mkdir(join(f.installationRoot,'packages'));
 for(const [feed,version,app]of [[join(f.installationRoot,'packages'),'2.1.0',f.oldRoot],[f.feed,'3.0.0-alpha1',f.paths.sourcePackage]]){
  await execute('python',['-c',py,feed!,id,version!,app!,join(vendor,'StubExecutable.exe')],{windowsHide:true});
 }
 const old=await readFile(join(f.installationRoot,'packages',oldName));
 await writeFile(join(f.installationRoot,'packages','RELEASES'),createHash('sha1').update(old).digest('hex')+' '+oldName+' '+old.length+'\n');
 const release=f.request.options.image.squirrel!,pkg=await readFile(join(f.feed,release.package.path));
 release.updater={bytes:updater.length,sha256:digest(updater)};
 release.package={...release.package,bytes:pkg.length,sha256:digest(pkg),sha1:createHash('sha1').update(pkg).digest('hex')};
 f.request.options.target.packageFiles=await f.inventory(f.paths.sourcePackage);
 f.request.options.rollback.packageFiles=await f.inventory(f.oldRoot);
 f.request.options.image.packageFiles=structuredClone(f.request.options.target.packageFiles);
 f.resign();Object.assign(f.options,f.request.options);f.options.trust=f.trust;
 await ps("$p='Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\"+id+"'\n"+
  "$existing=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($p);if($null -ne $existing){$existing.Dispose();throw 'TEST_KEY_ALREADY_EXISTS'}\n"+
  "$k=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($p)\n"+
  "try{$k.SetValue('InstallLocation',"+quote(f.installationRoot)+");$k.SetValue('DisplayVersion','2.1.0');$k.SetValue('TEST_ONLY_KEEP','retained');$k.Flush()}finally{$k.Dispose()}");
 const deps={observeOffline:async()=>({authority:'fixe-independent' as const,session:'TEST_ONLY',observedAt:Date.now(),obs:'idle' as const,twitch:'offline' as const}),
  authorize:async()=>true,noOtherWriters:async()=>true,assessRestartSafety:async()=>({safe:true})};
 return {...f,deps,id};
}
it('runs real Squirrel FULL-package apply and explicit complete rollback on a unique temporary per-user QA installation',async()=>{
 const f=await realFixture(),before=await f.inventory(f.installationRoot);
 expect((await inspectWindowsAuthenticode(join(f.paths.sourcePackage,'StreamDashboard.exe')))?.version).toBe('3.0.0.0');
 const installed=await runNativeWindowsMaintenance({...f.request,action:'install',options:f.options},f.deps);
 expect(installed,proof.nativeDiagnostic).toMatchObject({phase:'installed',installed:true,pending:false});
 expect(await f.inventory(f.newRoot)).toEqual(f.options.target.packageFiles);
 const preparedFeed=join(f.options.journalDirectory,'squirrel-feed-'+f.options.manifest.id);
 const state=await nativeSquirrelState('read',f.installationRoot,preparedFeed,f.options.image.squirrel!,f.trust.windowsSigner);
 expect(state.registry.find(r=>r.name==='DisplayVersion')?.value).toBe('3.0.0-alpha1');
 expect(state.registry.find(r=>r.name==='TEST_ONLY_KEEP')?.value).toBe('retained');
 const registration='Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\'+f.id;
 const changeVersion=(version:string)=>ps('$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('+quote(registration)+',$true);try{$k.SetValue(\'DisplayVersion\','+quote(version)+');$k.Flush()}finally{$k.Dispose()}');
 await changeVersion('2.1.0');
 await expect(nativeSquirrelState('read',f.installationRoot,preparedFeed,f.options.image.squirrel!,f.trust.windowsSigner)).rejects.toThrow('NATIVE_UNCONFIRMED');
 await changeVersion('3.0.0-alpha1');
 const rolled=await runNativeWindowsMaintenance({...f.request,action:'rollback',options:f.options},f.deps);
 expect(rolled).toMatchObject({phase:'rolledBack',rolledBack:true,pending:false});
 expect(await f.inventory(f.installationRoot)).toEqual(before);
},120000);
it('uses actual OS trust rejection before native effects when the QA certificate simulation is disabled',async()=>{
 const f=await realFixture();proof.allowTestTrust=false;const before=await f.inventory(f.installationRoot);
 await expect(runNativeWindowsMaintenance({...f.request,action:'install',options:f.options},f.deps)).rejects.toThrow('NATIVE_SIGNER_UNVERIFIED');
 expect(await f.inventory(f.installationRoot)).toEqual(before);
 expect(await readdir(f.options.journalDirectory)).toEqual([]);
},120000);
