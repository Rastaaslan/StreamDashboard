import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,rm,writeFile,link} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {decodeWindowsSignatureOutput,inspectWindowsAuthenticode,windowsApplicationEntry,windowsVersionMatches} from '../apps/desktop/src/streamcockpit-windows-authenticode.js';
import {createNativeWindowsImageAttester} from '../apps/desktop/src/streamcockpit-native-maintenance.js';
const dirs:string[]=[];
afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true})});
const windows=process.platform==='win32'?it:it.skip;
const sample=()=>({status:'Valid',signer:'A'.repeat(40),sha256:'b'.repeat(64),version:'3.0.0-alpha.1'});
it('decodes only an exact native result and normalizes hash/certificate data (synthetic result, not certificate proof)',()=>{
 expect(decodeWindowsSignatureOutput(JSON.stringify(sample()),'C:\\synthetic.exe',1000)).toEqual({status:'valid',
  signer:'A'.repeat(40),sha256:'b'.repeat(64),version:'3.0.0-alpha.1',path:'C:\\synthetic.exe',observedAt:1000});
});
it.each(['NotSigned','HashMismatch','NotTrusted','UnknownError','NotSupportedFileFormat','Incompatible'])('never promotes native %s to valid',status=>{
 expect(decodeWindowsSignatureOutput(JSON.stringify({...sample(),status,signer:''}),'C:\\synthetic.exe',1000)?.status).toBe('invalid');
});
it.each([{signer:'untrusted'},{sha256:'bad'},{status:'valid'},{extra:'injected'},{version:'bad\nversion'}])('rejects incomplete or substituted native output %j',patch=>{
 expect(decodeWindowsSignatureOutput(JSON.stringify({...sample(),...patch}),'C:\\synthetic.exe',1000)).toBeUndefined();
});
it('selects the actual StreamDashboard application from the pinned inventory, never an unrelated helper executable',()=>{
 const entry=(path:string)=>({path,bytes:1,sha256:'b'.repeat(64)});
 expect(windowsApplicationEntry([entry('StreamDashboard.exe'),entry('chrome_crashpad_handler.exe')]).path).toBe('StreamDashboard.exe');
 expect(windowsApplicationEntry([entry('StreamCockpit.exe')]).path).toBe('StreamCockpit.exe');
 expect(()=>windowsApplicationEntry([entry('helper.exe')])).toThrow('AMBIGUOUS');
 expect(()=>windowsApplicationEntry([entry('StreamCockpit.exe'),entry('StreamDashboard.exe')])).toThrow('AMBIGUOUS');
});
windows('uses the actual Windows verifier to reject an unsigned temporary file without modifying or executing it',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sc3-authenticode-'));dirs.push(dir);
 const file=join(dir,"unsigned [fixture] '.exe"),bytes=Buffer.from('SYNTHETIC_NOT_AN_EXECUTABLE');
 await writeFile(file,bytes);
 const result=await inspectWindowsAuthenticode(file);
 expect(result).toMatchObject({status:'invalid',path:file,sha256:createHash('sha256').update(bytes).digest('hex')});
 expect(await readFile(file)).toEqual(bytes);
},25000);
windows('refuses hardlinks, missing files, relative paths, alternate streams and non-local namespaces',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sc3-authenticode-'));dirs.push(dir);
 const file=join(dir,'unsigned.exe');await writeFile(file,'fixture');const alias=join(dir,'alias.exe');await link(file,alias);
 for(const path of [file,alias,join(dir,'missing.exe'),'relative.exe','\\\\server\\share\\app.exe','C:\\app.exe:stream'])
  expect(await inspectWindowsAuthenticode(path)).toBeUndefined();
});
windows('does not attest a signed identity from expected metadata alone when real native trust is missing',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sc3-authenticode-'));dirs.push(dir);
 const file=join(dir,'StreamDashboard.exe'),bytes=Buffer.from('UNSIGNED_SYNTHETIC_IMAGE');await writeFile(file,bytes);
 const expected={identity:{version:'3.0.0',revision:'a'.repeat(40),applicationId:'fixture.app',signer:'A'.repeat(40)},
  packageFiles:[{path:'StreamDashboard.exe',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}],profileFiles:[]};
 const attest=createNativeWindowsImageAttester(dir,[expected]);
 expect(await attest()).toBeUndefined();expect(await readFile(file)).toEqual(bytes);
},25000);

it('matches the actual Forge numeric PE version without conflating different signed SemVer inventories',()=>{
 expect(windowsVersionMatches('3.0.0','3.0.0-alpha.1')).toBe(true);
 expect(windowsVersionMatches('3.0.0.0','3.0.0-alpha.1')).toBe(true);
 expect(windowsVersionMatches('3.0.0-alpha.1','3.0.0-alpha.1')).toBe(true);
 for(const observed of ['3.0.1','3.0.0.1','3.0.0-alpha.2','3.0.0 trailing',''])
  expect(windowsVersionMatches(observed,'3.0.0-alpha.1')).toBe(false);
});
