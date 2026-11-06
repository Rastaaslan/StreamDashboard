import type {UpgradeMigration} from '../../../packages/core/src/streamcockpit-upgrade.js';
import type {HostDurableWriterQuiescence} from '../../server/src/streamcockpit-durable-writer-quiescence.js';
import {checkpointQaProfile,migrateQaProfileCopy,restoreQaProfile} from './streamcockpit-upgrade-qa-checkpoint.js';

/**
 * F10 LAB ONLY: one bounded, voluntary maintenance sequence on a synthetic
 * Windows QA workspace. The three F02/F08/F09 writers MUST be registered
 * and accessed exclusively through the same gate by the caller.
 *
 * This does not quiesce other processes, real user data, OBS, or StreamCockpit
 * services. There is deliberately no IPC, updater or install entry point.
 */
export async function runQuiescedQaUpgrade(
  workspace:string,toVersion:number,migrations:UpgradeMigration[],
  gate:HostDurableWriterQuiescence,options:{migrateLegacyMoments?:true}={},
){
  return gate.withQuiesced(async()=>{
    gate.assertQuiesced();
    const checkpoint=await checkpointQaProfile(workspace);
    // No protected writer may re-enter between checkpoint and final recovery.
    gate.assertQuiesced();
    const migration=await migrateQaProfileCopy(workspace,toVersion,migrations,options);
    gate.assertQuiesced();
    const recovery=await restoreQaProfile(workspace);
    gate.assertQuiesced();
    return {checkpoint,migration,recovery};
  });
}
