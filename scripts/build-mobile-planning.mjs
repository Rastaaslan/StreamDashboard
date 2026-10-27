import { build } from 'esbuild';
import path from 'node:path';
import { readFile, readdir, rm } from 'node:fs/promises';
const licenses=await Promise.all(['crypto-js','entities'].map(async name=>'Third-party dependency: '+name+'\n'+(await readFile('node_modules/'+name+'/LICENSE','utf8')).split('\n').map(line=>line.trimEnd()).join('\n')));
const entries={
  uuid:`export {randomUuid} from './packages/core/src/uuid.ts';`,
  'device-utils':`export {randomUuid} from './packages/core/src/uuid.ts';
    export {createHash as createIdentityHash,createBinaryHash} from './scripts/mobile-hash-shim.js';
    export {defaultProductProfile,validateProductProfile} from './packages/core/src/product-profile.ts';`,
  'provider-utils':`export {parseWizeBotCatalog} from './integrations/wizebot/src/catalog.ts';
    export {normalizeStreamlabsHistory,mergeStreamlabsHistory} from './integrations/streamlabs/src/history.ts';
    export {googleRecurrence,parseGoogleRecurrence} from './integrations/google-calendar/src/recurrence.ts';
    export {generateTwitchTags} from './packages/core/src/twitch-tags.ts';`,
  'planning-engine':`export {PlanningOrchestrator} from './packages/core/src/planning.ts';
    export * from 'entry:uuid';export * from 'entry:device-utils';export * from 'entry:provider-utils';`,
};
// Only builder-owned hash chunks are removed. Handwritten shared modules stay intact.
const generated='apps/mobile/shared/generated';
for(const file of await readdir(generated).catch(()=>[]))if(/^chunk-[A-Z0-9]+\.js$/.test(file))await rm(path.join(generated,file));
await build({
  entryPoints:Object.fromEntries(Object.keys(entries).map(name=>[name,'entry:'+name])),
  preserveSymlinks:true,outdir:'apps/mobile/shared',chunkNames:'generated/chunk-[hash]',
  bundle:true,splitting:true,format:'esm',platform:'browser',target:'es2022',
  external:['crypto'],legalComments:'eof',banner:{js:'/*!\n'+licenses.join('\n\n')+'\n*/'},
  plugins:[{name:'browser-planning-platform',setup(builder){
    builder.onResolve({filter:/^entry:/},args=>({path:args.path.slice(6),namespace:'entry'}));
    builder.onLoad({filter:/.*/,namespace:'entry'},args=>({contents:entries[args.path],resolveDir:process.cwd()}));
    builder.onResolve({filter:/^node:crypto$/},()=>({path:path.resolve('scripts/mobile-hash-shim.js')}));
    builder.onResolve({filter:/sync-performance\.js$/},()=>({path:path.resolve('scripts/mobile-sync-shim.js')}));
  }}],
});
