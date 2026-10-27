import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const [previous,candidate,report]=process.argv.slice(2);
if(!previous||!candidate||!report)throw new Error('Usage: OLD_APK NEW_APK REPORT_JSON; APKSIGNER and AAPT may select local Android build tools.');
function inspect(file){
 const signature=execFileSync(process.env.APKSIGNER||'apksigner',['verify','--verbose','--print-certs',file],{encoding:'utf8'});
 const certificates=[...signature.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([a-f0-9]+)$/gmi)].map(v=>v[1].toLowerCase()).sort();
 if(!certificates.length)throw new Error('No verified APK signer');
 const metadata=execFileSync(process.env.AAPT||'aapt',['dump','badging',file],{encoding:'utf8'});
 const match=metadata.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m);
 if(!match)throw new Error('Invalid APK package metadata');
 return {certificates,applicationId:match[1],versionCode:Number(match[2]),version:match[3]};
}
const old=inspect(previous),next=inspect(candidate),version=JSON.parse(await readFile('package.json','utf8')).version;
if(JSON.stringify(old.certificates)!==JSON.stringify(next.certificates)||old.applicationId!==next.applicationId||next.versionCode<=old.versionCode||next.version!==version)throw new Error('APK upgrade refused: signing identity, package or version mismatch. Do not uninstall the old app or generate replacement keys.');
await writeFile(report,JSON.stringify({compatible:true,installed:false,previous:old,candidate:next,sha256:createHash('sha256').update(await readFile(candidate)).digest('hex')},null,2)+'\n');
