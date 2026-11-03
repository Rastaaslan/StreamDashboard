import {existsSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..'),env=process.env;
const exists=file=>Boolean(file&&existsSync(file));
let sdk=env.ANDROID_HOME||env.ANDROID_SDK_ROOT||'';
const properties=join(root,'android/local.properties');
if(!sdk&&exists(properties)){
  const match=readFileSync(properties,'utf8').match(/^sdk\.dir=(.+)$/m);
  sdk=match?.[1].trim().replaceAll('\\:',':').replaceAll('\\\\','\\')||'';
}
const java=spawnSync('java',['-version'],{encoding:'utf8',windowsHide:true,timeout:5000});
const result={schemaVersion:1,checkedAt:new Date().toISOString(),sourceCommit:spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).stdout.trim(),
  windows:{electronRuntime:exists(join(root,'node_modules/electron/dist/electron.exe')),forgeCli:exists(join(root,'node_modules/.bin/electron-forge.cmd')),
    configuredCertificate:exists(env.WINDOWS_CERTIFICATE_FILE),certificatePasswordPresent:Boolean(env.WINDOWS_CERTIFICATE_PASSWORD)},
  android:{javaAvailable:java.status===0,sdkConfigured:Boolean(sdk),sdkExists:exists(sdk),
    platform35:exists(sdk&&join(sdk,'platforms/android-35/android.jar')),buildTools35:exists(sdk&&join(sdk,'build-tools/35.0.0/lib/apksigner.jar')),
    gradleWrapper:exists(join(root,'android/gradlew.bat')),stableKeyPresent:exists(env.ANDROID_KEYSTORE_PATH),
    signingEnvironmentComplete:['ANDROID_KEYSTORE_PATH','ANDROID_KEYSTORE_PASSWORD','ANDROID_KEY_ALIAS','ANDROID_KEY_PASSWORD'].every(k=>Boolean(env[k]))},
  releaseEligible:false,blockers:[]};
if(!result.windows.electronRuntime)result.blockers.push('WINDOWS_ELECTRON_DEVELOPMENT_RUNTIME_MISSING');
if(!result.windows.configuredCertificate)result.blockers.push('WINDOWS_SIGNING_CHAIN_NOT_CONFIGURED');
if(!result.android.sdkExists||!result.android.platform35||!result.android.buildTools35)result.blockers.push('ANDROID_SDK_35_BUILD_TOOLS_MISSING');
if(!result.android.stableKeyPresent||!result.android.signingEnvironmentComplete)result.blockers.push('ANDROID_EXISTING_PRODUCTION_SIGNING_NOT_CONFIGURED');
result.blockers.push('G2_G3_G4_G5_NOT_QUALIFIED');
if(process.argv.includes('--save')){mkdirSync(join(root,'.build'),{recursive:true});writeFileSync(join(root,'.build/sc3-toolchain.json'),JSON.stringify(result,null,2)+'\n')}
console.log(JSON.stringify(result,null,2));
