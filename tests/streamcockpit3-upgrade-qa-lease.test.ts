import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withExclusiveQaUpgradeLease} from '../apps/desktop/src/streamcockpit-upgrade-qa-lease.js';

const dirs:string[]=[];
afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true})});
const fixture=async()=>{const dir=await mkdtemp(join(tmpdir(),'sc3-upgrade-qa-'));dirs.push(dir);return dir};

describe('F10 detached QA: exclusive admission across separate processes',()=>{
  it('refuses a second owner while preserving first owner until completion',async()=>{
    const root=await fixture();
    let release!:()=>void;
    const held=new Promise<void>(resolve=>{release=resolve});
    const first=withExclusiveQaUpgradeLease(root,async()=>{
      expect((await readFile(join(root,'upgrade-qa-exclusive.lock'),'utf8')).length).toBeGreaterThan(20);
      await expect(withExclusiveQaUpgradeLease(root,async()=>true))
        .rejects.toThrow('SC3_QA_LEASE_ALREADY_OWNED');
      await held;
      return 'complete';
    });
    release();
    expect(await first).toBe('complete');
    expect(await withExclusiveQaUpgradeLease(root,async()=>42)).toBe(42);
  });

  it('fails closed on interrupted migration and requires manual orphan review',async()=>{
    const root=await fixture();
    await expect(withExclusiveQaUpgradeLease(root,async()=>{throw Error('copy uncertain')}))
      .rejects.toThrow('copy uncertain');
    await expect(withExclusiveQaUpgradeLease(root,async()=>true))
      .rejects.toThrow('SC3_QA_LEASE_ALREADY_OWNED');
  });

  it('refuses a stolen or replaced lock rather than unlinking another owner',async()=>{
    const root=await fixture(),lock=join(root,'upgrade-qa-exclusive.lock');
    await expect(withExclusiveQaUpgradeLease(root,async()=>{
      await rm(lock);
      await writeFile(lock,'other process');
    })).rejects.toThrow('SC3_QA_LEASE_OWNERSHIP_UNCERTAIN');
    expect(await readFile(lock,'utf8')).toBe('other process');
  });

  it('rejects a non-QA workspace before creating any lock',async()=>{
    await expect(withExclusiveQaUpgradeLease(tmpdir(),async()=>true))
      .rejects.toThrow('SC3_QA_LEASE_WORKSPACE_DENIED');
  });
});
