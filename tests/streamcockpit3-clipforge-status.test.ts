import {expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const script=resolve(root,'scripts/streamcockpit3-clipforge-status.ts');
function run(args:string[]=[]){
  return spawnSync(process.execPath,['--import','tsx',script,...args],{
    cwd:root,encoding:'utf8',windowsHide:true,timeout:15000,
    env:{...process.env,
      SC3_F04_FFMPEG:'',SC3_F04_FFPROBE:'',SC3_F04_SUPERVISOR:'',
      SC3_F04_OUTPUT_ROOT:'',
    },
  });
}
it('F04 status is read-only and never claims a release without host binaries or private ACL',()=>{
  const result=run();
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  const json=JSON.parse(result.stdout);
  expect(json.product).toBe('StreamCockpit 3.0');
  expect(json.binaries).toEqual({
    qualified:false,reasons:[process.platform==='win32'?'BINARIES_MISSING':'WINDOWS_ONLY'],
  });
  expect(json.outputAcl).toEqual({
    qualified:false,reasons:['OUTPUT_ROOT_NOT_CONFIGURED'],
  });
  expect(json.releaseEligible).toBe(false);
  expect(JSON.stringify(json)).not.toContain('C:\\Users');
});
it('F04 --final always blocks absent OBS provenance, signatures and rollback',()=>{
  const result=run(['--final']);
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('"releaseEligible": false');
  expect(result.stderr).toContain('SC3_F04_RELEASE_BLOCKED');
});
