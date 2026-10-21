import {readFile} from 'node:fs/promises';
import {SETUPS} from '../apps/mobile/shared/installation.js';

const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
const publication=process.argv.includes('--publication'),prerelease=manifest.version.includes('-');
if(publication&&process.env.GITHUB_REF_NAME?.startsWith('v')&&process.env.GITHUB_REF_NAME!==`v${manifest.version}`)throw Error('Le tag ne correspond pas à la version du paquet.');
const final=process.argv.includes('--final')||(publication&&!prerelease);
const matrix=JSON.parse(await readFile(new URL('../docs/qa/next21-qualification.json',import.meta.url),'utf8'));
const requiredModules=['obs-aitum','macros','twitch','youtube','viewers','chats','streamlabs','wizebot','planning','sounds','obs-clips'];
const requiredScenarios=['single-device','multiple-devices','android-paired','android-standalone','obs-agent-stopped','controller-stopped','network-loss','reconnection','role-change','rc117-migration'];
const requiredTransitions=['single-to-dual','dual-to-single','add-device','remove-device','add-android','remove-android','move-roles','restore-configuration','migrate-rc117'];
const exact=(actual,expected)=>Array.isArray(actual)&&actual.length===expected.length&&new Set(actual).size===actual.length&&expected.every(x=>actual.includes(x));
if(matrix.version!==1||!exact(matrix.setups,Object.keys(SETUPS))||!exact(matrix.scenarios,requiredScenarios)||!exact(matrix.modules?.map(m=>m.id),requiredModules)||!exact(matrix.transitions?.map(t=>t.id),requiredTransitions))throw Error('Matrice universelle incomplète ou incompatible.');
const blocked=[];
for(const module of matrix.modules){
 if(!exact(module.qualification?.map(q=>q.setup),Object.keys(SETUPS)))throw Error('Setups manquants : '+module.id);
 for(const row of module.qualification){
  const expected=row.setup==='android-only'&&['obs-aitum','obs-clips'].includes(module.id)?'unavailable':'supported';
  if(row.behavior!==expected)throw Error('Compatibilité incorrecte : '+module.id+'/'+row.setup);
  if(row.implementation!=='complete'||row.automated!=='passed'||row.hardware!=='passed'||!Array.isArray(row.evidence)||!row.evidence.length)blocked.push(module.id+'/'+row.setup);
 }
}
for(const row of matrix.transitions)if(row.automated!=='passed'||row.hardware!=='passed'||!Array.isArray(row.evidence)||!row.evidence.length)blocked.push('transition/'+row.id);
if(blocked.length){
 console.log(`Next 2.1 : ${blocked.length} qualifications restent ouvertes. Version universelle non livrable.`);
 if(final){console.error('UNIVERSAL_NOT_QUALIFIED : compléter les preuves automatisées et matérielles de docs/qa/next21-qualification.json.');process.exitCode=1;}
}else console.log('Matrice universelle complète avec preuves automatisées et matérielles référencées.');

if(publication&&prerelease)console.log('Publication intermédiaire uniquement : '+manifest.version+' doit rester marquée prerelease.');
