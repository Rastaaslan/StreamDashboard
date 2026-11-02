import {afterAll,beforeAll,describe,it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

let directory='',artifact='';
beforeAll(async()=>{
  directory=await mkdtemp(path.join(tmpdir(),'sc3-readonly-artifact-'));
  artifact=path.join(directory,'StreamAgent-ReadOnly.mjs');
  const build=spawnSync(process.execPath,['scripts/build-agent-readonly-qa.mjs','--output-dir',directory],
    {cwd:process.cwd(),shell:false,windowsHide:true,timeout:15000,encoding:'utf8'});
  expect(build.error).toBeUndefined();expect(build.status,build.stderr).toBe(0);
});
afterAll(async()=>{if(directory)await rm(directory,{recursive:true,force:true})});

describe('built read-only portable artifact cannot inherit OBS write authority',()=>{
  it.each(['SD_AGENT_OBS_WRITER_OPT_IN','SD_AGENT_OBS_WRITER_CONTROLLER_ID',
    'SD_AGENT_OBS_WRITER_GRANTS','SD_AGENT_OBS_WRITER_FUTURE_OPTION'])('refuses %s before the bundled service starts',async setting=>{
    const profile=await mkdtemp(path.join(tmpdir(),'sc3-readonly-profile-'));
    try{
      const env={...process.env,APPDATA:profile,
        STREAMDASHBOARD_AGENT_READONLY_OPT_IN:'I_ACCEPT_READ_ONLY',
        [setting]:'I_ACCEPT_REAL_OBS_WRITES'};
      const child=spawnSync(process.execPath,[artifact,'--monitor','--use-local-obs-config'],
        {cwd:process.cwd(),env,shell:false,windowsHide:true,timeout:5000,encoding:'utf8'});
      expect(child.error).toBeUndefined();expect(child.status).toBe(1);
      expect(child.stderr).toContain('READ_ONLY_QA_WRITER_CONFIG_REFUSED');
      expect(child.stderr).not.toContain('READ_ONLY_AGENT_START_FAILED');
      expect(child.stdout).toBe('');expect(await readdir(profile)).toEqual([]);
    }finally{await rm(profile,{recursive:true,force:true})}
  });
  it('the manifest declares the inherited writer boundary and no permitted OBS mutations',async()=>{
    const manifest=JSON.parse(await readFile(path.join(directory,'MANIFEST-QA.json'),'utf8'));
    expect(manifest.obsRpcMutations).toEqual([]);
    expect(manifest.inheritedObsWriterConfiguration).toBe('REFUSED_BEFORE_STARTUP');
    expect(manifest.scope).toBe('EXPERIMENTAL_PORTABLE_NON_DEPLOYABLE');
  });
});
