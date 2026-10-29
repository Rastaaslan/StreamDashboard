#!/usr/bin/env node
/**
 * Explicit QA-only build. Never installs, starts or modifies the running
 * StreamDashboard, OBS, network listeners, Windows services or credentials.
 */
import {build} from 'esbuild';
import {copyFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'apps/agent/src/windows-readonly-service.ts');
const output=path.join(root,'dist/agent-readonly-qa');
const executable=path.join(output,'StreamAgent-ReadOnly.mjs');
await mkdir(output,{recursive:true});
await build({
  entryPoints:[source],outfile:executable,
  bundle:true,platform:'node',format:'esm',target:'node22',minify:true,
  sourcemap:false,legalComments:'none',
  banner:{js:'import {createRequire} from "node:module"; const require=createRequire(import.meta.url);'},
  logLevel:'silent',
});
const files=['StreamAgent-ReadOnly.mjs','Start-Agent-ReadOnly.ps1',
  'LISEZ-MOI-Agent-ReadOnly-QA.txt'];
for(const name of files.slice(1))
  await copyFile(path.join(root,'resources/agent-readonly',name),path.join(output,name));
const manifest={
  kind:'StreamDashboard Agent V2 read-only QA',
  scope:'EXPERIMENTAL_PORTABLE_NON_DEPLOYABLE',
  requiredNodeMajor:22,
  obsRpcAllowlist:['GetStats','GetStreamStatus'],
  obsRpcMutations:[],
  listenerByDefault:false,
  autoInstall:false,
  secretsIncluded:false,
  files:{},
};
for(const name of files) {
  const body=await readFile(path.join(output,name));
  manifest.files[name]={bytes:body.length,
    sha256:createHash('sha256').update(body).digest('hex')};
}
await writeFile(path.join(output,'MANIFEST-QA.json'),
  JSON.stringify(manifest,null,2)+'\n');
console.log('AGENT_READONLY_PORTABLE_QA_BUILD_PASS');
console.log('QA_OUTPUT='+output);
console.log('QA_BUNDLE_SHA256='+manifest.files['StreamAgent-ReadOnly.mjs'].sha256);
